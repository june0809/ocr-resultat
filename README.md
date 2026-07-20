# ocr-resultat

Service d'ingestion de résultats de match par capture d'écran de scoreboard.

Projet **autonome** : repo, déploiement et cycle de vie propres. Il n'accède
jamais à la base d'un client — il expose une API et renvoie du JSON validé.

**Le cahier des charges complet est dans [SPEC.md](SPEC.md).** À lire avant de
coder — en particulier la section 2 (la frontière) et la section 6 (le contrat
d'API, à figer en premier).
