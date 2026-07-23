# Spec — OCR de scoreboard, piloté de bout en bout depuis The Circle

**Version 2.0 — 22/07/2026** (remplace la v1.0 du 17/07)
Document de cadrage à remettre au développeur du service OCR (repo séparé
`ocr-resultat`). Le service reste un **projet séparé** (repo, déploiement, cycle
de vie propres) et **n'accède jamais à la base de The Circle**. Ce qui change en
v2, ce n'est pas la frontière — c'est **qui affiche quoi** et **comment l'OCR est
fait**.

---

## 0. Ce qui change depuis la v1 (à lire en premier)

La v1 partait sur : OCR **dans le navigateur** (Tesseract.js), une **page
d'upload chez le service**, et une **grille à caler à la main**. On abandonne ces
trois points.

| Sujet | v1 (abandonné) | v2 (cette spec) |
|---|---|---|
| Où se fait l'OCR | Navigateur (Tesseract.js WASM) | **Service, côté serveur** (Tesseract natif + repli vision) |
| Page d'upload | Chez le service | **Aucune. Tout se passe dans l'admin de The Circle** |
| Grille | Calée à la main par l'utilisateur | **Détection 100 % automatique**, zéro geste |
| Précision noms | Tesseract seul | **Hybride** : Tesseract pour les chiffres, **repli vision (Claude Haiku) sur les cellules incertaines** |
| Correspondance pseudo→membre | Résolue à chaque fois | **Alias persistants** : on relie une fois, c'est mémorisé pour toujours |
| Jeu visé V2 | générique | **CODM d'abord**, template auto-ancré ; autres jeux ensuite |

Ce que la v2 **garde intact** : la frontière (le service ne touche jamais la
base), le contrat par **pseudo** (jamais de `profile_id` côté service), la
**validation humaine obligatoire** avant enregistrement, et le principe **on ne
stocke jamais les captures**.

---

## 1. En une phrase

Dans The Circle, quand un organisateur saisit les scores d'une partie, il peut
**au lieu de tout taper** cliquer sur « Importer une capture », déposer le
screenshot du scoreboard de fin de partie, et **quelques secondes plus tard le
tableau est déjà rempli**. Les cellules sûres sont noires, les douteuses
surlignées orange/rouge. Il corrige les rares erreurs, relie les pseudos
inconnus par glisser-déposer (mémorisé pour la prochaine fois), et valide.

Le service OCR, lui, ne fait qu'une chose : **image → JSON structuré par
pseudo, avec un score de confiance par cellule.** Il ne sait rien de The Circle.

---

## 2. Le flux vécu par l'organisateur (la cible produit)

C'est la partie qui compte le plus. Tout ce qui suit doit servir ce parcours.

1. L'organisateur est dans **l'écran de saisie des scores** d'un match (déjà
   existant dans The Circle : modes MJ et BR). Il peut toujours tout remplir à
   la main — rien n'est retiré.
2. Un bouton **« Importer une capture »** ouvre un sélecteur de fichier /
   glisser-déposer. Il dépose une (ou plusieurs) capture(s) de scoreboard.
3. The Circle envoie l'image au service OCR et affiche un état « lecture en
   cours… ». **Aucune grille à placer, aucun réglage.**
4. Quelques secondes après, **le tableau de saisie se remplit tout seul** :
   pseudo, kills, morts, assists, placement, MVP.
5. **Surlignage de confiance**, directement sur les cellules du tableau :
   - **noir / normal** : lu avec haute confiance ;
   - **orange** : valeur lue mais douteuse (à vérifier d'un coup d'œil) ;
   - **rouge** : pseudo **non relié** à un membre, ou cellule illisible.
6. **Réconciliation des pseudos par glisser-déposer.** Si le jeu affiche
   « Henri » et que dans la base il s'appelle « Jean », l'organisateur **fait
   glisser la ligne « Henri » sur le membre « Jean »** (ou choisit dans une
   liste). Le lien est posé.
   - **Ce lien est mémorisé.** La prochaine capture où apparaît « Henri » le
     reliera automatiquement à Jean, sans rien redemander. Pareil quand
     quelqu'un change de pseudo en jeu : on relie une fois le nouveau pseudo.
7. **Édition directe** : n'importe quelle cellule (chiffre ou pseudo) est
   modifiable à la main en cas de souci.
8. L'organisateur clique **« Valider »** → The Circle enregistre via sa logique
   de scoring **déjà existante** (`save-results`). Le service n'écrit jamais rien.

> Tout ce parcours vit **dans The Circle**. Le service n'a **pas** de page, pas
> d'écran, pas d'UI. Il reçoit une image en HTTP, il renvoie du JSON.

---

## 3. La frontière (inchangée, non négociable)

```
  ┌──────────────────────────────┐          ┌──────────────────────────────────┐
  │   SERVICE OCR (lui)          │          │   THE CIRCLE (toi)               │
  │   repo/déploiement séparés   │  image   │                                  │
  │                              │ ───────► │  Admin dépose une capture        │
  │  image ─► pré-traitement ─►  │          │  Affiche le tableau pré-rempli   │
  │  Tesseract (chiffres) ─►     │  JSON    │  Surligne les cases douteuses    │
  │  repli vision (pseudos) ─►   │ ◄─────── │  Réconcilie pseudo → membre      │
  │  JSON par PSEUDO + confiance │  (API)   │  (+ ALIAS persistants)           │
  │                              │          │  Résout pseudo → profile_id      │
  │  AUCUNE DB, AUCUN profile_id │          │  Écrit dans SES tables (scoring) │
  └──────────────────────────────┘          └──────────────────────────────────┘
```

- Le service reçoit une **image**, rend un **JSON par pseudo**. Il ne connaît
  aucun `profile_id`, n'a aucun accès à la base, ne stocke aucune capture.
- **La correspondance `pseudo → compte` et les alias vivent côté The Circle
  uniquement.** Le service ne « corrige » jamais un pseudo : il rend le texte
  brut lu à l'écran, c'est The Circle qui rapproche.
- Piège classique : le dev du service qui demande « juste un accès lecture à la
  base pour tester ». **Non.** Tout se teste avec des captures et des réponses
  JSON. Le contrat (§5) est figé pour que la question ne se pose jamais.

---

## 4. Le pipeline OCR côté service (le cœur technique)

Objectif : **lire un scoreboard automatiquement, sans grille manuelle, le plus
juste possible, gratuitement.** On reprend les techniques éprouvées de l'OCR
« gameplay » d'un pote (Tesseract natif + pré-traitement par zone), on les
adapte au **cas image fixe** (beaucoup plus simple que sa vidéo), et on ajoute un
**repli vision** là où Tesseract cale : les pseudos stylisés.

### 4.1 Ce qu'on emprunte à l'OCR du pote — et ce qu'on jette

Son OCR à lui traite de la **vidéo** (kills LoL/Valorant image par image). Le
gros de sa perf vient de l'**extraction ffmpeg one-pass / NVDEC** — **hors sujet
ici** : on a une seule image fixe, il n'y a rien à extraire. Ce qu'on **garde**,
c'est sa recette OCR, qui est excellente :

| Technique (chez lui) | On la garde ? | Usage scoreboard |
|---|---|---|
| **Tesseract 5.x LSTM natif** (binaire) + `pytesseract` | **Oui** | Moteur de base, gratuit, illimité |
| **Crops en fractions de `in_w`/`in_h`** (720p-safe) | **Oui** | Rend le template **indépendant de la résolution** |
| **Pré-traitement Pillow** : invert, contraste, seuillage | **Oui, essentiel** | La clé de la fiabilité sur police de jeu |
| **Upscale du crop** (`KF_SCALE=1.5`) | **Oui** | Tesseract lit bien mieux du texte agrandi |
| **`--psm 7` (ligne unique) + `tessedit_char_whitelist=0123456789/`** | **Oui** | Colonnes **chiffres** (K/D/A, placement) : fiabilité maximale |
| **Cascade multi-seuil/psm** (ex. `(215,7)→(160,11)→(235,11)`) | **Oui** | Plusieurs passes par cellule, on garde la meilleure confiance |
| **`image_to_data`** (boîtes + coords + **confiance par mot**) | **Oui** | Fournit la confiance par cellule qu'on remonte à The Circle |
| `OMP_THREAD_LIMIT=1` + `ThreadPoolExecutor` | **Oui** | Détail perf : force mono-thread par process, parallélise au pool |
| Extraction ffmpeg one-pass, NVDEC, `-skip_frame nokey` | **Non** | Spécifique vidéo, aucun intérêt sur image fixe |
| Contrainte K monotone croissant, `refine_events`, killfeed | **Non** | Logique temporelle vidéo, pas un scoreboard figé |

> Son propre benchmark (2026-07-14) a **rejeté EasyOCR / OCR GPU** parce que chez
> lui l'OCR ne pèse que ~15 % du coût (85 % = extraction vidéo). **Ce verdict ne
> transfère pas chez nous** : pas de vidéo → l'OCR est **100 %** du coût, et
> notre point dur n'est pas la vitesse mais **le nom exact**. D'où le repli
> vision ci-dessous, que lui n'avait aucune raison d'ajouter.

### 4.2 Zéro grille manuelle : template auto-ancré

Un scoreboard a une **mise en page fixe pour un écran de jeu donné**. On
n'utilise donc **pas** d'OCR plein cadre (bouillie garantie), mais on ne demande
**pas non plus** à l'utilisateur de caler une grille. On automatise :

1. **Template relatif par jeu/écran** (coordonnées 0.0–1.0), comme en v1 mais
   **jamais montré à l'utilisateur**. Pour CODM, deux gabarits au départ :
   - `codm_br` : liste de placement (battle royale) ;
   - `codm_mp` : scoreboard d'équipe (multijoueur / classé).
2. **Auto-échelle** : on lit les dimensions réelles de l'image et on projette le
   template en pixels. Les fractions rendent tout **résolution-safe** (720p,
   1080p, captures de téléphone recadrées…).
3. **Auto-ancrage des lignes** (au lieu d'un `rows.top` figé) : on détecte les
   bandes de lignes par **profil de projection** (somme des contrastes par ligne
   de pixels) pour trouver le haut de la liste et le pas entre joueurs, robuste
   aux petits décalages d'UI. C'est ce qui remplace la grille manuelle.
4. **Filet de sécurité** : si l'ancrage échoue ou si la confiance globale est
   basse, on **bascule en lecture vision plein-board** (§4.4) plutôt que de
   rendre du vide. L'utilisateur n'a jamais à intervenir sur la géométrie.

> V2 = **CODM d'abord**. Ajouter un jeu = ajouter un template + calibrer le
> pré-traitement, sans toucher au reste. Pas de détection auto du jeu en V2 :
> The Circle envoie `game` (et l'écran BR vs MP) dans la requête.

### 4.3 Lecture cellule par cellule

Pour chaque cellule découpée par le template :

- **Colonnes chiffres** (`placement`, `kills`, `deaths`, `assists`) :
  pré-traitement (gris → contraste → seuil → upscale 1.5), puis
  `--psm 7 -c tessedit_char_whitelist=0123456789/`. **Cascade** de 2–3 couples
  seuil/psm, on garde la lecture de meilleure confiance. Ancre regex quand le
  jeu affiche un triplet groupé `K/D/A` : `(\d+)/(\d+)/(\d+)`.
- **Colonne pseudo** : `--psm 7`, **sans** whitelist (texte libre). C'est la
  cellule fragile. Tesseract donne une **première proposition + une confiance**.
  Si la confiance passe le seuil, on la garde ; sinon → repli vision (§4.4).
- **Badge MVP** : test pixel / icône (comme le « gate doré » de l'OCR vidéo),
  pas de l'OCR. Renseigne `is_mvp`.

On utilise **`image_to_data`** (pas `image_to_string`) pour récupérer la
**confiance par cellule** : c'est elle qui pilote le surlignage orange/rouge côté
The Circle.

### 4.4 Le repli vision (hybride) — sur les cellules, pas sur tout

C'est l'ajout central de la v2. Tesseract restera mauvais sur les **polices de
pseudo stylisées** quoi qu'on règle. Donc :

- Tesseract lit **tout** d'abord (gratuit).
- **Seules les cellules sous le seuil de confiance** (typiquement les pseudos, et
  toute cellule chiffre incohérente) sont renvoyées à un **modèle vision
  (Claude Haiku 4.5)**, en lui passant **le petit crop de la cellule** + un
  prompt strict (« rends uniquement le texte exact affiché, rien d'autre »).
- Coût : on n'envoie que quelques imagettes, pas la capture entière →
  **< 1 €/mois** au volume d'un clan. Le modèle vision n'est appelé que sur le
  chemin fragile ; les scoreboards nets ne le déclenchent jamais.
- **Flag + budget** : le repli reste **derrière un flag** avec un plafond
  d'appels/jour. Éteint → le service marche quand même (Tesseract seul, plus de
  cellules en « douteux »). C'est un **curseur qualité**, pas une dépendance.

Le crop plein-board (§4.2, filet de sécurité) utilise le même modèle vision, mais
n'est déclenché que si la géométrie échoue.

> **Clé API du modèle vision : côté service** (c'est son moteur, son déploiement,
> son coût — cohérent avec « projet séparé »). The Circle ne voit que le JSON
> final. Aucun coût récurrent ne retombe sur The Circle.

### 4.5 Confiances & warnings

Chaque cellule sort avec sa confiance (Tesseract, ou 1.0/haute si corrigée par
vision). Le service agrège :

- `confidence` par joueur = **min** des cellules du joueur ;
- `confidence` global = moyenne pondérée ;
- une liste de `warnings` pour toute cellule sous seuil, tout placement en
  double, tout chiffre non numérique, tout pseudo vide.

Ces champs pilotent directement le surlignage et la revue humaine côté The Circle
(§6). **Le service n'enregistre jamais rien et ne décide jamais à la place de
l'humain.**

---

## 5. Contrat d'API (figé)

Point d'entrée unique. **En v2 le chemin principal est l'image** (l'OCR est fait
par le service). Le chemin « JSON déjà extrait » reste accepté pour tests /
compatibilité, mais n'est plus le nominal.

### 5.1 `POST /v1/matches`

**Auth :** `Authorization: Bearer sk_<clé>` (voir §7). **Multipart** (`image`) ou
**JSON base64** au choix.

**Corps — cas image (nominal v2) :**

```json
{
  "source": "the_circle",
  "game": "codm",
  "screen": "codm_br",
  "image_base64": "<png/jpg base64, sans en-tête data:>"
}
```

- `game` : identifiant de jeu (`codm` en V2).
- `screen` : gabarit d'écran (`codm_br` | `codm_mp`). Optionnel ; si absent, le
  service tente de reconnaître le gabarit, sinon renvoie `unreadable_scoreboard`.
- Taille max (ex. 8 Mo), MIME vérifié.

**Corps — cas JSON déjà extrait (compat/tests) :** identique à la v1 (`extracted.teams[...]`).

### 5.2 Réponse (format de sortie général du service)

```json
{
  "match_id": "b3f1c2a0-…",
  "game": "codm",
  "mode": "battle_royale",
  "screen": "codm_br",
  "captured_at": "2026-07-22T18:14:03Z",
  "source": "the_circle",
  "confidence": 0.91,
  "engine": { "tesseract_cells": 38, "vision_cells": 4 },
  "teams": [
    {
      "placement": 1,
      "players": [
        {
          "pseudo": "AZ-1234",
          "kills": 12, "deaths": 3, "assists": 5,
          "is_mvp": true,
          "confidence": 0.94,
          "fields": {
            "pseudo":    { "value": "AZ-1234", "confidence": 0.72, "source": "vision" },
            "kills":     { "value": 12, "confidence": 0.98, "source": "tesseract" },
            "deaths":    { "value": 3,  "confidence": 0.97, "source": "tesseract" },
            "assists":   { "value": 5,  "confidence": 0.95, "source": "tesseract" },
            "placement": { "value": 1,  "confidence": 0.99, "source": "tesseract" }
          }
        }
      ]
    }
  ],
  "warnings": [
    { "code": "low_confidence_pseudo", "player": "AZ-1234", "detail": "0.72 < 0.80" }
  ]
}
```

Nouveautés v2 par rapport au format v1, **rétro-compatibles** (champs en plus) :

- **`fields`** : la confiance **et la source** (`tesseract` | `vision`) **par
  cellule**. C'est ce qui permet à The Circle de surligner **cellule par
  cellule** (orange/rouge) plutôt que ligne entière.
- **`engine`** : combien de cellules ont nécessité le repli vision (observabilité
  / suivi du budget).
- Le reste est identique à la v1 : `mode` ∈ `battle_royale` | `team_deathmatch`
  | `free_for_all`, entiers ≥ 0, `pseudo` **brut non modifié**, **jamais** de
  `profile_id`/email.

### 5.3 Erreurs

Identiques à la v1 : `400 invalid_body`, `401 invalid_api_key`,
`422 unreadable_scoreboard`, `429 rate_limited` (+ `Retry-After`), `500 internal`.

---

## 6. Côté The Circle : réconciliation + alias persistants

**Tout ce chapitre est du travail The Circle**, décrit ici pour que le dev du
service comprenne pourquoi son contrat s'arrête au pseudo. Le service **n'a rien
à coder ici**.

### 6.1 Point d'entrée dans la saisie de scores

Le composant de saisie de scores existant (MJ et BR) reçoit un bouton
**« Importer une capture »**. Au dépôt, The Circle appelle son endpoint interne
`POST /api/ocr/ingest` (déjà en place), qui relaie l'image au service, récupère
le JSON, résout les pseudos, et **pré-remplit le tableau**. Rien n'est enregistré
tant que l'organisateur n'a pas validé.

### 6.2 Surlignage par cellule

À partir des `fields[].confidence` et du statut de résolution du pseudo :

- **normal** : chiffre haute confiance / pseudo relié avec certitude ;
- **orange** : `confidence` sous seuil, ou pseudo relié en *fuzzy* (à confirmer) ;
- **rouge** : pseudo **non relié** (aucun membre trouvé) ou cellule illisible.

### 6.3 Réconciliation par glisser-déposer + édition

- Chaque ligne pseudo non résolue affiche les **candidats les plus proches**
  (déjà fournis par `resolvePseudo`) ; l'organisateur clique le bon **ou fait
  glisser la ligne sur le membre**.
- Toute cellule (chiffre ou pseudo) est **éditable en ligne**.
- Les membres attendus mais **absents du scoreboard** sont signalés
  (`roster_coverage.missing`, déjà calculé côté ingest).

### 6.4 Alias persistants (la demande centrale)

Quand l'organisateur relie un pseudo brut à un membre, **on mémorise le lien**
pour que ce ne soit **jamais redemandé** :

- **Nouvelle table** (migration The Circle, à créer dans
  `supabase/migrations/`) :

  ```sql
  create table public.ocr_pseudo_aliases (
    id            uuid primary key default gen_random_uuid(),
    community_id  uuid not null references public.communities(id) on delete cascade,
    pseudo_norm   text not null,          -- pseudo brut normalisé (norm() de resolve.ts)
    profile_id    uuid not null references public.profiles(id) on delete cascade,
    created_by    uuid references public.profiles(id),
    created_at    timestamptz not null default now(),
    unique (community_id, pseudo_norm)
  );
  ```

- **Priorité de résolution** (à ajouter dans `resolvePseudo` / l'ingest) :
  **0. alias** (correspondance exacte sur `pseudo_norm` dans la commu) → membre
  direct, statut `alias` (traité comme certain) ; puis 1. exact, 2. clan,
  3. fuzzy, 4. unresolved. L'alias court-circuite tout et n'est jamais redemandé.
- **Écriture** : à la validation, chaque lien posé/confirmé manuellement fait un
  `upsert` dans `ocr_pseudo_aliases`. Un pseudo qui **change** en jeu = un
  nouvel alias posé une fois. Un pseudo réattribué à quelqu'un d'autre =
  l'organisateur écrase l'alias (upsert sur la clé unique).
- **Portée** : par **communauté** (le même pseudo peut viser des personnes
  différentes selon la commu). Cohérent avec le cloisonnement par commu.

> Rappel scoring : une fois les `profile_id` confirmés, The Circle construit son
> payload interne et appelle **`save-results`** existant
> (`team_deathmatch` → MJ, `battle_royale` → BR). Inchangé.

---

## 7. Sécurité, coût, stockage

- **Clé d'API par communauté cliente** (`sk_…`), hachée, révocable, rate-limit
  par clé (`Retry-After` sur 429). La clé `sk_` de The Circle reste **côté
  serveur** (jamais dans le bundle client) — déjà le cas dans `ocr/client.ts`.
- **La capture transite** vers le service (nécessaire pour l'OCR serveur) mais
  **n'est jamais stockée** : on lit, on rend le JSON, on jette l'image. Ni côté
  service, ni côté The Circle (cf. contrainte egress Supabase). Argument
  commercial conservé : « vos captures ne sont pas conservées ».
- **Aucune donnée personnelle** côté service : pas de `profile_id`, pas d'email,
  pas de pseudo journalisé au-delà du strict debug (anonymisé/purgé).
- **Coût** : Tesseract natif = gratuit/illimité ; vision = quelques imagettes de
  cellule seulement, **< 1 €/mois**, **plafonné + derrière un flag**, **porté par
  le service** (pas par The Circle). Éteint = zéro coût, qualité un cran en
  dessous.

---

## 8. Stack gratuite (suggestion)

| Brique | Choix gratuit | Note |
|---|---|---|
| Moteur OCR | **Tesseract 5.x LSTM natif** + `pytesseract` | binaire vendoré si pas de sudo (recette du pote) |
| Pré-traitement | **Pillow** (invert/contraste/seuil/upscale) | la vraie clé de fiabilité |
| Découpe/normalisation image | Pillow / OpenCV (crop, gris) | pas besoin de ffmpeg (image fixe) |
| Parallélisme | `ThreadPoolExecutor`, `OMP_THREAD_LIMIT=1` | mono-thread par process, pool au-dessus |
| Repli vision | **Claude Haiku 4.5**, flag + plafond | ~centimes/mois, crops de cellule uniquement |
| API/hébergement | Vercel Hobby ou Cloudflare | valideur + orchestration OCR léger |
| Stockage | **aucun** | on ne garde pas les images |

---

## 9. Jalons révisés

**Côté service (`ocr-resultat`) :**

- **Lot A — image → JSON, Tesseract seul, CODM.** `POST /v1/matches` accepte
  l'image, applique template auto-ancré + pré-traitement + Tesseract par cellule,
  renvoie le format §5.2 avec `fields`/confidences. Repli vision **éteint**. Doit
  passer proprement sur les captures d'exemple CODM.
- **Lot B — repli vision hybride.** Cellules sous seuil → crop → Haiku, flag +
  plafond, `engine` renseigné. Filet plein-board si géométrie échoue.
- **Lot C — 2e gabarit + robustesse.** `codm_mp` en plus de `codm_br`,
  reconnaissance de gabarit si `screen` absent, durcissement des seuils.

**Côté The Circle (en parallèle, contrat figé) :**

- **Lot 1 — UX de réconciliation.** Bouton « Importer une capture » dans la
  saisie de scores, tableau pré-rempli, surlignage **par cellule** (orange/rouge)
  à partir de `fields`, édition inline, drag-drop sur les candidats.
- **Lot 2 — alias persistants.** Migration `ocr_pseudo_aliases`, priorité
  **alias** dans la résolution, upsert à la validation.
- **Lot 3 — multi-captures & finitions.** Plusieurs captures pour un même match,
  fusion, couverture de roster.

---

## 10. Ce qu'il ne faut **pas** faire (anti-specs)

- **À proscrire :** donner au service un accès (même lecture) à la base de The Circle.
- **À proscrire :** faire transiter ou deviner un `profile_id`, un email, une identité réelle.
- **À proscrire :** stocker les captures d'écran (ni service, ni The Circle).
- **À proscrire :** « corriger » les pseudos côté service — il rend le texte brut, The Circle rapproche.
- **À proscrire :** enregistrer des résultats automatiquement sans validation humaine.
- **À proscrire :** demander à l'utilisateur de placer/caler une grille. **Géométrie 100 % automatique**, filet vision si échec.
- **À proscrire :** appeler le modèle vision sur la capture entière par défaut — **seulement les cellules incertaines**, derrière flag + plafond.
- **À proscrire :** porter le pipeline vidéo one-pass/NVDEC de l'OCR gameplay — hors sujet sur image fixe.
- **À proscrire :** coder en dur la mise en page d'un jeu dans le pipeline — passer par les templates §4.2.

---

Le contrat (§5) et la frontière (§3) sont figés : c'est ce qui protège la base et
laisse le service évoluer seul. Tout le reste (pipeline, seuils, UX) peut bouger.
