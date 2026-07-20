# Message pour l'équipe The Circle

> Message prêt à envoyer (Discord / mail) au dev de The Circle. Remplace les
> `<…>` par les vraies valeurs avant l'envoi. Ne colle **jamais** la clé `sk_…`
> dans le repo ni dans un salon public — passe-la en DM.

---

Salut 👋

Le service OCR de scoreboards est en ligne, et votre moitié peut commencer à s'y
brancher **dès maintenant**. Voici tout ce qu'il vous faut.

## En deux mots

Vous nous envoyez les résultats d'un scoreboard (déjà lus à l'écran), on vous
renvoie du **JSON validé** : joueurs, kills, morts, placement, avec un score de
confiance. C'est tout. **On ne connaît aucun de vos comptes**, on ne stocke aucune
capture, on ne touche jamais à votre base. Le point de contact entre nous, c'est
**le pseudo** : on vous les rend bruts, c'est vous qui faites `pseudo → profile_id`
de votre côté.

## Ce dont vous avez besoin

| | |
|---|---|
| **URL** | `https://<url>.vercel.app` |
| **Endpoint** | `POST /v1/matches` |
| **Sonde (sans auth)** | `GET /api/health` |
| **Votre clé** | `sk_…` *(envoyée en DM)* |
| **Auth** | header `Authorization: Bearer sk_<votre-clé>` |

## Tester la connexion

```bash
curl -s https://<url>.vercel.app/api/health
# → {"status":"ok","service":"ocr-resultat","lot":1}
```

## Appeler l'endpoint

Pour l'instant on attend le JSON **déjà extrait** (`source: "web"`). Le chemin
image (capture postée sur Discord) arrivera plus tard — d'ici là il répond
`501 ocr_not_available`.

```bash
curl -s https://<url>.vercel.app/v1/matches \
  -H "Authorization: Bearer sk_VOTRE_CLE" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "web",
    "game": "warzone",
    "mode": "battle_royale",
    "extracted": {
      "teams": [
        { "placement": 1, "players": [
          { "pseudo": "AZ-1234", "kills": 12, "deaths": 3, "assists": 5, "confidence": 0.94 } ] },
        { "placement": 2, "players": [
          { "pseudo": "Rico", "kills": 8, "deaths": 5, "assists": 2, "confidence": 0.88 } ] }
      ]
    }
  }'
```

Trois modes possibles :
- **battle_royale** — plusieurs `teams`, chacune avec son `placement`.
- **team_deathmatch** — exactement 2 `teams`, `placement` 1 (gagnante) / 2.
- **free_for_all** — 1 seule `team`, `placement` porté au niveau **joueur**.

Détails pratiques :
- **`confidence` (joueur) est optionnelle** : si vous l'omettez (lecture web déjà
  propre), on applique `1.0` par défaut. Vous pouvez aussi l'envoyer explicitement.
- **`captured_at` (optionnel, au niveau racine)** : envoyez l'**heure réelle du
  match** (ISO 8601, UTC `Z` ou offset accepté) et on la renvoie telle quelle. Si
  absent, on met notre heure serveur (= heure d'appel).
- **`is_mvp` (booléen, optionnel, par joueur)** : badge MVP. Passthrough — lu en
  entrée, réémis tel quel dans `teams[].players[].is_mvp`, jamais déduit côté
  service. Voir `examples/web-codm-tdm.json`.

## Ce que vous recevez

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

- `match_id` et `captured_at` : générés par nous.
- `confidence` global = moyenne des confidences joueurs.
- `warnings` = les cases douteuses (`low_confidence_pseudo`,
  `duplicate_placement`). À afficher en surbrillance pour validation humaine avant
  d'enregistrer quoi que ce soit.
- On ne renvoie **jamais** de `profile_id`/email, et on ne « corrige » jamais un
  pseudo — c'est votre job.

## Les erreurs à gérer

Toujours la même forme : `{ "error": { "code": "…", "message": "…" } }`

| HTTP | code | quand |
|---|---|---|
| 400 | `invalid_body` | JSON malformé / champ manquant / règle de mode violée |
| 401 | `invalid_api_key` | clé absente ou invalide |
| 422 | `unreadable_scoreboard` | confiance globale trop basse |
| 429 | `rate_limited` | quota dépassé (~60/min), voir header `Retry-After` |
| 501 | `ocr_not_available` | chemin image (pas encore dispo) |

## Ce que vous branchez derrière

1. Vous recevez le JSON ci-dessus.
2. Pour chaque `pseudo` : match exact → format clan (`AZ-XXXX`) → approximatif
   (Levenshtein) proposé pour validation.
3. Les pseudos non résolus / douteux → présentés à l'orga, **jamais enregistrés
   en silence**.
4. Une fois `pseudo → profile_id` fait → votre payload interne → votre scoring.
   (`team_deathmatch` → mode MJ, `battle_royale` → mode BR chez vous.)

## Vous n'avez pas besoin de nous pour avancer

Le contrat est **figé** : il ne bougera pas quand on ajoutera la vraie lecture
d'image. Vous pouvez bouchonner les réponses ci-dessus et coder votre résolution
tout de suite. Quand le vrai OCR arrivera, la sortie sera **identique**.

Des questions, on est là. 🙌
