# Kit d'intégration — pour l'équipe The Circle

Ce document permet à The Circle d'appeler le service OCR **en condition réelle**
et de brancher sa résolution `pseudo → profile_id`. Le contrat est **figé**
(SPEC §6) : il ne changera pas quand l'OCR (Lot 2+) arrivera, la sortie restera
identique.

> Rappel de la frontière (SPEC §2) : le service **rend du JSON, point**. Il ne
> connaît aucun `profile_id`, ne stocke aucune capture, n'accède à aucune base.
> Toute la résolution `pseudo → compte` vit **côté The Circle**.

---

## 1. Ce qu'on vous fournit

| Élément | Valeur |
|---|---|
| **URL de base** | `https://<a-completer>.vercel.app` *(fournie après déploiement Vercel)* |
| **Endpoint** | `POST /v1/matches` |
| **Sonde** | `GET /api/health` (sans auth) |
| **Clé d'API de test** | `sk_…` *(fournie séparément, par canal sûr — jamais dans le repo)* |

L'auth se fait par header : `Authorization: Bearer sk_<votre-clé>`.

---

## 2. Vérifier la connectivité

```bash
curl -s https://<url>/api/health
# → {"status":"ok","service":"ocr-resultat","lot":1}
```

---

## 3. Appeler l'endpoint (chemin navigateur — le seul actif en Lot 1)

Le service attend le JSON **déjà extrait** (`source: "web"`). Le chemin image
(`source: "discord"`) répond `501 ocr_not_available` tant que l'OCR serveur n'est
pas livré (Lot 4).

```bash
curl -s https://<url>/v1/matches \
  -H "Authorization: Bearer sk_VOTRE_CLE" \
  -H "Content-Type: application/json" \
  --data @examples/web-battle-royale.json
```

### Corps de requête, par mode

- **battle_royale** — plusieurs `teams`, chacune avec un `placement`.
  → `examples/web-battle-royale.json`
- **team_deathmatch** — exactement 2 `teams`, `placement` 1 (gagnante) / 2.
  → `examples/web-team-deathmatch.json`
- **free_for_all** — 1 seule `team`, `placement` porté **au niveau joueur**.
  → `examples/web-free-for-all.json`

Champs joueur : `pseudo` (string brute), `kills`/`deaths`/`placement` (entiers ≥ 0),
`assists` (optionnel), `confidence` (0.0–1.0).

---

## 4. Réponse (SPEC §6.2)

Exemple pour `examples/web-battle-royale.json` :

```json
{
  "match_id": "b3f1c2a0-…",
  "game": "warzone",
  "mode": "battle_royale",
  "captured_at": "2026-07-20T20:14:03Z",
  "source": "web",
  "confidence": 0.91,
  "teams": [
    { "placement": 1, "players": [
      { "pseudo": "AZ-1234", "kills": 12, "deaths": 3, "assists": 5, "confidence": 0.94 } ] },
    { "placement": 2, "players": [
      { "pseudo": "Rico", "kills": 8, "deaths": 5, "assists": 2, "confidence": 0.88 } ] }
  ],
  "warnings": [
    { "code": "low_confidence_pseudo", "player": "Rico", "detail": "0.88 < 0.90" }
  ]
}
```

- `match_id` et `captured_at` sont **générés par le service**.
- `confidence` (global) = **moyenne** des confidences joueurs.
- `warnings` : cellules douteuses. Codes actuels : `low_confidence_pseudo`,
  `duplicate_placement`. À afficher en surbrillance pour validation humaine (§9).
- Le service **ne renvoie jamais** de `profile_id`, email ou identité, et **ne
  corrige jamais** un pseudo.

---

## 5. Cas d'erreur à gérer (SPEC §6.3)

Format uniforme : `{ "error": { "code": "…", "message": "…" } }`

| HTTP | `code` | Déclencheur | À tester |
|---|---|---|---|
| 400 | `invalid_body` | JSON malformé, champ manquant, règle de mode violée | `teams: []` |
| 401 | `invalid_api_key` | clé absente ou invalide | sans header `Authorization` |
| 422 | `unreadable_scoreboard` | confiance globale sous le minimum exploitable | toutes confidences < 0.50 |
| 429 | `rate_limited` | quota dépassé (~60 req/min) — header `Retry-After` | boucle rapide |
| 501 | `ocr_not_available` | chemin image (Lot 4 pas encore là) | `source: "discord"` |

---

## 6. Ce que The Circle branche derrière (rappel, SPEC §7)

1. Reçoit la réponse du §4.
2. Pour chaque `pseudo` : correspondance exacte → format clan (`AZ-XXXX`) →
   approximative (Levenshtein) proposée pour validation.
3. Pseudos non résolus / basse confiance → présentés à l'organisateur, **jamais
   enregistrés en silence**.
4. Une fois `pseudo → profile_id` résolu → payload interne existant → scoring.

Traduction des modes vers l'interne : `team_deathmatch` → « MJ »,
`battle_royale` → « BR ».

---

## 7. Tester sans nous (contrat figé)

Vous n'avez **pas besoin** de notre disponibilité pour avancer : bouchonnez les
réponses du §4 à partir des fichiers `examples/*.json` et codez votre résolution
contre. Quand l'OCR réel arrivera (Lot 2+), la sortie sera **identique** — votre
code ne bougera pas.
