# ocr-resultat

Service d'ingestion de résultats de match par capture d'écran de scoreboard.

Projet **autonome** : repo, déploiement et cycle de vie propres. Il n'accède
jamais à la base d'un client — il expose une API et renvoie du JSON validé.

**Le cahier des charges complet est dans [SPEC.md](SPEC.md).** À lire avant de
coder — en particulier la section 2 (la frontière) et la section 6 (le contrat
d'API, à figer en premier).

---

## Lot 1 — le squelette (contrat figé)

Ce qui est implémenté ici : l'endpoint `POST /v1/matches` qui **valide** le JSON
déjà extrait côté navigateur, l'authentifie par clé, applique un rate-limit et
renvoie la réponse du §6.2. **Aucun OCR** : on prouve le contrat avec des entrées
bouchonnées (§11, Lot 1). C'est ce lot qui verrouille la frontière avec The Circle.

Stack : **Next.js (App Router) sur Vercel Hobby**. Le même projet hébergera la
page d'upload (Lot 2). Pas de base de données : le service est un valideur
*stateless*, il ne stocke ni captures ni résultats (§3.2, §12). Seules les **clés
d'API** existent, sous forme **hachée** dans une variable d'environnement.

### Arborescence

```
app/
  api/
    v1/matches/route.ts   # POST /v1/matches — le handler (auth, rate-limit, validation)
    health/route.ts       # GET /api/health — sonde
  layout.tsx  page.tsx    # page d'accueil minimale (upload en Lot 2)
lib/
  schema.ts               # validation Zod du contrat §6 (règles BR/TDM/FFA)
  auth.ts                 # vérif clé Bearer sk_… par hash SHA-256 (§8)
  ratelimit.ts            # limiteur par tenant (en mémoire — voir avertissement)
  response.ts             # construction de la réponse §6.2 (confiance, warnings)
  errors.ts  cors.ts      # format d'erreur uniforme §6.3 ; CORS §8
scripts/keygen.mjs        # génère une paire (clé brute + hash) pour un client
examples/                 # payloads d'exemple pour tester
```

## Démarrer en local

> Prérequis : **Node.js 18+** (installer depuis nodejs.org). Il n'était pas
> présent sur la machine de dev au moment de l'écriture — à installer avant de
> lancer quoi que ce soit.

```bash
npm install
cp .env.example .env.local        # puis générer une clé (ci-dessous)
npm run keygen -- the-circle      # affiche la clé BRUTE + l'entrée API_KEYS
# → colle l'entrée "hash:label" dans API_KEYS de .env.local
npm run dev                       # http://localhost:3000
npm run typecheck                 # vérif TypeScript sans build
```

### Tester l'endpoint

```bash
curl -s http://localhost:3000/v1/matches \
  -H "Authorization: Bearer sk_LA_CLE_BRUTE" \
  -H "Content-Type: application/json" \
  --data @examples/web-battle-royale.json | jq
```

## Le contrat en bref (§6)

- **`POST /v1/matches`**, `Authorization: Bearer sk_<clé>`.
- Corps Lot 1 : `{ source:"web", game, mode, extracted:{ teams:[…] } }`.
- Réponse : `{ match_id, game, mode, captured_at, source, confidence, teams, warnings }`.
- Erreurs uniformes `{ error:{ code, message } }` : `invalid_body` (400),
  `invalid_api_key` (401), `unreadable_scoreboard` (422), `rate_limited` (429),
  `internal` (500). Le chemin image (`source:"discord"`) renvoie `501
  ocr_not_available` tant que l'OCR serveur n'est pas là (Lot 4).
- Le service **ne renvoie jamais** de `profile_id`/email/identité, et **ne
  corrige jamais** un pseudo (§12).

## Communication avec The Circle (schéma « pull »)

Le service est **passif** : c'est The Circle qui l'appelle.

```
Organisateur ──upload capture──►  [notre service]  ──JSON (§6.2)──►  The Circle
                                                                       │
                          The Circle résout pseudo → profile_id, score, écrit chez lui
```

The Circle est un **client** parmi d'autres : il reçoit de nous **une URL** (ex.
`https://<projet>.vercel.app/v1/matches`) et **une clé d'API** générée via
`npm run keygen`. Toute la logique `pseudo → compte` vit **chez lui** (§7). Nous
ne poussons rien vers sa base, nous ne connaissons aucun `profile_id`.

## Déploiement Vercel (Hobby)

1. Pousser ce repo sur GitHub (déjà `github.com/june0809/ocr-resultat`).
2. Sur Vercel → **New Project** → importer le repo. Le framework Next.js est
   détecté automatiquement, aucune config de build à toucher.
3. **Environment Variables** (onglet Settings) : ajouter `API_KEYS` (les
   `hash:label`), `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SEC`,
   `CONFIDENCE_WARN_THRESHOLD`, `CONFIDENCE_MIN_USABLE`, `ALLOWED_ORIGIN`
   (domaine de la page d'upload). **Ne jamais** committer les clés.
4. Deploy. L'endpoint est alors `https://<projet>.vercel.app/v1/matches`.

> ⚠️ **Rate-limit** : l'implémentation Lot 1 est **en mémoire, par instance**.
> Sur Vercel serverless c'est approximatif (chaque instance a son compteur).
> Avant une vraie montée en charge, brancher **Vercel KV / Upstash Redis** dans
> `lib/ratelimit.ts` (la signature `check()` ne changera pas). Voir le TODO dans
> le fichier.
