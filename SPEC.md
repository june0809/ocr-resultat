# Spec — Service d'ingestion de résultats de match par capture d'écran

**Version 1.0 — 17/07/2026**
Document de cadrage à remettre au développeur du service. Le service est un
**projet séparé** (repo, déploiement, cycle de vie propres). Il ne fait pas partie
de The Circle et n'accède jamais à sa base de données.

---

## 1. En une phrase

On envoie la **capture d'écran d'un scoreboard de fin de partie**, le service
la transforme en **résultats structurés** (joueurs, kills, morts, placement) et
renvoie du **JSON validé**. C'est tout. Il ne sait rien de The Circle, ne stocke
pas les images, et ne connaît aucun identifiant de joueur.

---

## 2. Pourquoi ce découpage (à lire avant de coder)

The Circle tient aujourd'hui ses scores de tournoi à la main. Ce service
automatise la saisie. Mais il est conçu pour être **vendable seul** : n'importe
quel clan ou orga esport a le même problème.

La règle d'or, non négociable : **le service ne touche jamais la base de The
Circle.** Il expose une API, il renvoie du JSON. Si le service plante, tombe, ou
sort une bêtise, The Circle continue de tourner exactement comme avant.

Le piège classique de ce genre de duo, c'est le développeur du service qui
demande « juste un accès à la base pour tester ». **La réponse est non.** Tout se
teste avec des captures et des réponses JSON bouchonnées. Le contrat d'API
ci-dessous est figé dès le départ pour que la question ne se pose jamais.

### La frontière, dessinée

```
  ┌─────────────────────────┐         ┌──────────────────────────────┐
  │   SERVICE OCR (lui)      │         │   THE CIRCLE (toi)           │
  │                         │         │                              │
  │  capture ─► OCR ─►      │  JSON   │  reçoit le JSON              │
  │  résultats par PSEUDO   │ ──────► │  résout PSEUDO ─► profile_id │
  │                         │  (API)  │  calcule le score            │
  │  ne connaît AUCUN       │         │  écrit dans ses tables       │
  │  profile_id, aucune DB  │         │                              │
  └─────────────────────────┘         └──────────────────────────────┘
```

Le point de bascule est **le pseudo**. Un scoreboard n'affiche que des pseudos
en jeu. Le service les lit et s'arrête là. La correspondance
`pseudo → compte The Circle` est faite **côté The Circle uniquement**, parce que
c'est la seule à connaître ses membres. Le service ne doit jamais recevoir ni
deviner un `profile_id`.

---

## 3. Contrainte : full gratuit (pour l'instant)

Objectif V1 : **zéro coût récurrent.** Deux leviers.

### 3.1 L'OCR tourne côté navigateur

Le pipeline principal est **Tesseract.js exécuté dans le navigateur** (WASM). La
capture n'est jamais envoyée à un serveur : le navigateur lit le scoreboard et
**seul le JSON structuré** quitte la machine. Conséquences :

- Coût serveur d'OCR : **nul**.
- Bande passante / stockage d'images : **nul** (rien n'est uploadé).
- Argument commercial fort : « vos captures ne quittent pas votre appareil ».

### 3.2 Le service lui-même est un simple valideur

Puisque l'OCR est fait côté client, le rôle du serveur se réduit à : recevoir le
JSON extrait, le **valider contre un schéma**, le normaliser, l'authentifier, et
le renvoyer (ou le relayer). Ça tient largement dans un tier gratuit
(Cloudflare Workers ou Vercel Hobby).

### 3.3 Le repli modèle vision — Phase 2, désactivé par défaut

Les polices de jeu sur fond semi-transparent mettent Tesseract en difficulté. La
parade en V1 est **le découpage en zones fixes** (voir §5), pas l'IA. Un repli
par modèle vision (Claude Haiku, ~0,3 centime la capture) est prévu **en Phase 2,
derrière un flag, éteint par défaut.** Tant qu'il est éteint : rien à payer. On
ne l'allume que si un client accepte le micro-coût pour gagner en robustesse.

> Règle de stockage, à respecter dès la V1 : **on ne garde jamais les captures.**
> On extrait le JSON, on jette l'image. C'est gratuit, c'est privé, et ça évite
> l'explosion de coût de stockage.

---

## 4. Ingestion : deux entrées

| Entrée | Qui fait l'OCR | Coût | Priorité |
|---|---|---|---|
| **Web** (page d'upload) | Le navigateur (Tesseract.js) | 0 | **V1** |
| **Discord** (on poste une capture) | Fonction serverless (Tesseract WASM) | 0 dans les quotas gratuits | V2 |

La V1 est **web d'abord** : c'est le chemin gratuit le plus simple et le plus
robuste. Le chemin Discord (le bot récupère l'URL de l'image et lance l'OCR
serveur) arrive ensuite ; en attendant, le bot peut répondre avec un lien vers la
page d'upload.

---

## 5. Le pipeline OCR (le cœur technique)

Ne **jamais** faire de l'OCR « plein cadre » sur un scoreboard : les polices
stylisées et les fonds translucides donnent de la bouillie. La bonne approche
exploite le fait qu'**un scoreboard a une mise en page fixe pour un jeu donné**.

### 5.1 Templates de jeu

Pour chaque jeu supporté, un **template** décrit où se trouve chaque colonne, en
coordonnées **relatives** (0.0–1.0) à l'image, pour tolérer les résolutions :

```json
{
  "game": "warzone",
  "mode": "battle_royale",
  "rows": { "top": 0.22, "height": 0.055, "count": 20 },
  "columns": [
    { "field": "placement", "x": 0.04, "width": 0.06, "type": "int" },
    { "field": "pseudo",    "x": 0.12, "width": 0.34, "type": "text" },
    { "field": "kills",     "x": 0.60, "width": 0.08, "type": "int" },
    { "field": "deaths",    "x": 0.70, "width": 0.08, "type": "int" }
  ]
}
```

Le pipeline découpe chaque cellule et lance Tesseract **case par case**, avec le
bon mode (`type: "int"` → whitelist de chiffres, bien plus fiable que du texte
libre). Le gain de fiabilité par rapport à l'OCR plein cadre est énorme.

### 5.2 V1 = un seul jeu, template manuel

La V1 supporte **un seul jeu** (celui du clan principal), avec un template écrit
à la main et, si besoin, un petit outil d'alignement où l'utilisateur cale une
grille sur sa capture. Ajouter un jeu = ajouter un template. Pas de détection
automatique de jeu en V1.

### 5.3 Score de confiance

Chaque cellule sort avec la confiance renvoyée par Tesseract. Le service agrège :

- `confidence` par joueur (min des cellules du joueur),
- `confidence` global du match,
- une liste de `warnings` pour toute cellule sous un seuil (ex. 0.75) ou toute
  valeur incohérente (placement en double, kills non numérique…).

Ces champs permettent à The Circle d'afficher les cases douteuses en surbrillance
pour validation humaine avant enregistrement (voir §9).

---

## 6. Contrat d'API

### 6.1 `POST /v1/matches`

Point d'entrée unique. Accepte **soit** le JSON déjà extrait côté navigateur
(chemin gratuit), **soit** une image à traiter côté serveur (chemin Discord /
Phase 2).

**Auth :** `Authorization: Bearer sk_<clé>` (voir §8).

**Corps — cas navigateur (OCR déjà fait côté client) :**

```json
{
  "source": "web",
  "game": "warzone",
  "mode": "battle_royale",
  "extracted": {
    "teams": [
      {
        "placement": 1,
        "players": [
          { "pseudo": "AZ-1234", "kills": 12, "deaths": 3, "assists": 5, "confidence": 0.94 }
        ]
      }
    ]
  }
}
```

**Corps — cas image (OCR côté serveur) :**

```json
{
  "source": "discord",
  "game": "warzone",
  "image_base64": "<png/jpg base64, sans en-tête data:>"
}
```

### 6.2 Réponse (identique dans les deux cas)

C'est **le format de sortie du service** — général, orienté esport, indépendant
de The Circle. Le service génère lui-même `match_id` et l'horodatage.

```json
{
  "match_id": "b3f1c2a0-...",
  "game": "warzone",
  "mode": "battle_royale",
  "captured_at": "2026-07-17T20:14:03Z",
  "source": "web",
  "confidence": 0.91,
  "teams": [
    {
      "placement": 1,
      "players": [
        { "pseudo": "AZ-1234", "kills": 12, "deaths": 3, "assists": 5, "confidence": 0.94 }
      ]
    },
    {
      "placement": 2,
      "players": [
        { "pseudo": "Rico",   "kills": 8, "deaths": 5, "assists": 2, "confidence": 0.88 }
      ]
    }
  ],
  "warnings": [
    { "code": "low_confidence_pseudo", "player": "Rico", "detail": "0.88 < 0.90" }
  ]
}
```

**Règles de format :**

- `mode` ∈ `battle_royale` | `team_deathmatch` | `free_for_all`.
  - `battle_royale` : plusieurs `teams`, chacune avec un `placement`.
  - `team_deathmatch` : exactement 2 `teams`, `placement` = 1 (gagnante) / 2.
  - `free_for_all` : 1 `team` contenant tous les joueurs, `placement` par joueur
    porté au niveau joueur (`players[].placement`).
- `kills`, `deaths`, `assists`, `placement` : entiers ≥ 0. `assists` optionnel
  (certains jeux ne l'affichent pas).
- `pseudo` : chaîne brute lue à l'écran, **non modifiée** (pas de « correction »
  côté service — c'est The Circle qui rapproche).
- `confidence` : flottant 0.0–1.0.
- Le service **ne renvoie jamais** de `profile_id`, d'email, ou quoi que ce soit
  qui identifie un compte The Circle. Il n'en a pas connaissance.

### 6.3 Erreurs

Format d'erreur uniforme, codes HTTP standard :

```json
{ "error": { "code": "unreadable_scoreboard", "message": "..." } }
```

| HTTP | `code` | Quand |
|---|---|---|
| 400 | `invalid_body` | JSON malformé, champ requis manquant |
| 401 | `invalid_api_key` | clé absente ou invalide |
| 422 | `unreadable_scoreboard` | OCR sous le seuil minimal exploitable |
| 429 | `rate_limited` | quota dépassé (header `Retry-After`) |
| 500 | `internal` | bug service |

---

## 7. Résolution des pseudos — **côté The Circle uniquement**

C'est le point le plus important à comprendre pour les deux côtés : **le service
ne fait pas ce travail.** Il rend des pseudos ; The Circle les rapproche de ses
comptes. La logique vit dans un unique endpoint de réception côté The Circle :

1. Reçoit la réponse du §6.2.
2. Pour chaque `pseudo`, tente de le rapprocher d'un membre de la communauté :
   - correspondance exacte sur le pseudo en jeu enregistré,
   - sinon correspondance sur le format clan (ex. `AZ-XXXX`, cf. convention
     Alcatraz),
   - sinon correspondance approximative (distance de Levenshtein) proposée pour
     validation.
3. Les pseudos **non résolus** ou de **basse confiance** ne sont pas enregistrés
   en silence : ils sont présentés à l'organisateur, qui confirme ou corrige
   (une capture aura toujours un pseudo mal lu de temps en temps).
4. Une fois les pseudos résolus en `profile_id`, The Circle construit son payload
   interne existant et le passe à sa logique de scoring déjà en place.

> Pour le développeur du service : tu n'as **rien** à coder ici. C'est décrit
> pour que tu comprennes pourquoi ton contrat s'arrête au pseudo, et pourquoi il
> ne faut surtout pas essayer de « deviner » l'identité d'un joueur.

### Rappel du bout The Circle (pour information, ne pas coder côté service)

The Circle possède déjà un endpoint interne qui enregistre des résultats par
`profile_id`, en deux formes :

- **Mode « MJ »** (équipes / affrontement) : par joueur `{ kills, assists,
  is_mvp_loser, malus }` + le camp gagnant. Le score est calculé serveur
  (`kills·pKill + assists·pAssist + mvp + win − malus`, barème par communauté).
- **Mode « BR »** (battle royale) : par équipe `{ placement, kills_total }`. Le
  score combine placement (top 10) et kills.

L'adaptateur de réception fait la traduction `sortie du service → payload
interne`. Cette correspondance est triviale (`team_deathmatch` → MJ,
`battle_royale` → BR) et vit côté The Circle.

---

## 8. Sécurité & authentification

- **Clé d'API par client** (`sk_...`), une par organisation/communauté cliente.
  Le service est multi-tenant : la clé identifie le tenant et sert au
  rate-limiting. Aucune notion de compte utilisateur final côté service.
- Clés stockées **hachées** (jamais en clair), révocables.
- **Rate limit par clé** (ex. 60 req/min), header `Retry-After` sur 429.
- **CORS** : la page web d'upload (chemin navigateur) appelle l'API depuis un
  domaine connu ; whitelist ce domaine.
- **Validation stricte du corps** avant tout traitement (schéma). Le chemin image
  vérifie le type MIME et une **taille max** (ex. 8 Mo) pour éviter l'abus.
- **Aucune donnée personnelle stockée.** Pas de capture conservée, pas de pseudo
  journalisé au-delà du strict nécessaire au debug (et si debug, anonymisé /
  purgé). Le service ne voit jamais d'email ni d'identité réelle.

---

## 9. Boucle de validation humaine (recommandée)

Un OCR n'est jamais parfait à 100 % sur des polices de jeu. Le flux nominal
n'enregistre donc **rien automatiquement** : le service rend les résultats **avec
leurs confidences**, et l'organisateur voit un tableau pré-rempli où les cases
douteuses (`warnings`, basse `confidence`, pseudo non résolu) sont surlignées. Il
corrige d'un clic, puis valide. On gagne 95 % de la saisie sans jamais risquer
d'enregistrer une bêtise.

---

## 10. Stack & hébergement gratuits (suggestion)

| Brique | Choix gratuit | Note |
|---|---|---|
| OCR navigateur | **Tesseract.js** (WASM) | tourne dans le client, coût nul |
| OCR serveur (Discord/V2) | Tesseract WASM dans une fonction | dans les quotas gratuits |
| API | **Cloudflare Workers** ou **Vercel Hobby** | valideur léger, tier gratuit |
| Page d'upload | Next.js / Vite statique | Vercel/CF Pages gratuit |
| Stockage | **aucun** | on ne garde pas les images |
| Repli vision (Phase 2) | Claude Haiku, derrière un flag | ~0,3 centime/capture, éteint par défaut |

Rien ici n'engage de coût récurrent tant que le repli vision reste éteint.

---

## 11. Jalons

**Lot 1 — le squelette (contrat figé).**
`POST /v1/matches` qui accepte le JSON `extracted` du §6.1, le valide, et renvoie
la réponse du §6.2. Auth par clé, rate limit, erreurs. Aucun OCR encore : on
prouve le contrat avec des entrées bouchonnées. **C'est ce lot qui verrouille la
frontière.**

**Lot 2 — l'OCR navigateur.**
Page d'upload + Tesseract.js + un template de jeu (le jeu du clan). Découpage en
zones, confidences, warnings. Sortie conforme au Lot 1.

**Lot 3 — la boucle de validation.**
Tableau pré-rempli, cases douteuses surlignées, correction + validation.

**Lot 4 (optionnel) — Discord & repli vision.**
Ingestion par capture postée sur Discord (OCR serveur) et flag de repli vision
pour les captures difficiles.

Côté The Circle, en parallèle : l'endpoint de réception (résolution pseudo →
`profile_id` + adaptateur vers le payload interne). **Indépendant** du planning du
service grâce au contrat figé.

---

## 12. Ce qu'il ne faut **pas** faire (anti-specs)

- **À proscrire :** Donner au service un accès (même lecture) à la base de The Circle.
- **À proscrire :** Faire transiter ou deviner un `profile_id`, un email, une identité réelle.
- **À proscrire :** Stocker les captures d'écran.
- **À proscrire :** « Corriger » les pseudos côté service (c'est le rôle du rapprochement côté
  The Circle ; le service rend le texte brut).
- **À proscrire :** Enregistrer des résultats automatiquement sans passe de validation humaine.
- **À proscrire :** Coder en dur la mise en page d'un jeu dans le pipeline — passer par des
  templates de §5.1.
- **À proscrire :** Allumer le repli vision « pour voir » : il a un coût, il reste éteint tant
  qu'un client ne l'a pas explicitement accepté.
```

Le contrat (§6) est figé : c'est lui qui protège ta base. Le reste peut bouger.
