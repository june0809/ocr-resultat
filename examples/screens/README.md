# Captures réelles CODM — vérité terrain pour l'OCR (Lot 2)

3 vraies captures du mode **Recherche & Destruction** (`team_deathmatch`, 5v5),
fournies par The Circle pour calibrer le template et vérifier l'OCR case par case.

| Capture | Fichier | Manches (G:D) | Vainqueur | Transcription attendue |
|---|---|---|---|---|
| 1 | `codm-tdm-01.jpg` | 5:4 | équipe **gauche** | [`../web-codm-tdm.json`](../web-codm-tdm.json) |
| 2 | `codm-tdm-02.jpg` | 3:5 | équipe **droite** | [`../web-codm-tdm-02.json`](../web-codm-tdm-02.json) |
| 3 | `codm-tdm-03.jpg` | 0:5 | équipe **droite** | [`../web-codm-tdm-03.json`](../web-codm-tdm-03.json) |

## Points de vigilance vérifiés sur ces captures

- **Layout** : 2 tableaux côte à côte (gauche = bleu, droite = rouge), 5 joueurs
  chacun. Colonnes : `rang · avatar · JOUEUR · SCORE · É/M/A · IMPACT`.
- **`É/M/A` est une cellule fusionnée** (ex. `15/7/0`) → découper en
  `kills` / `deaths` / `assists`.
- **`placement` se déduit du score de MANCHES** en haut à gauche (`5:4`, `3:5`,
  `0:5`), **pas** du mot `VICTOIRE`/`DÉFAITE` : ce label est relatif au joueur qui
  a pris la capture. Captures 2 et 3 : c'est écrit « DÉFAITE » alors que l'équipe
  gauche est affichée en premier — l'équipe gagnante est celle qui a le plus de
  manches (ici la droite). D'où l'intérêt de `rounds_won` comme source de vérité.
- **`is_mvp`** = le joueur badgé MVP de chaque équipe. Repli fiable : c'est le
  plus gros SCORE de l'équipe (vérifié sur les 3 captures).
- **Pseudos lus bruts, jamais corrigés** : côté gauche c'est propre
  (`AZ-Angelos`, parfois sans préfixe comme `Scusix`), côté droit c'est très
  stylisé (`ŁŐŃĚwOLfє`, `乙刀 · THE END`, `¤T¤O¤J¤I¤¤`) → sortira en basse
  confiance, c'est The Circle qui fait le rapprochement.

L'ordre des équipes dans les JSON suit la lecture **gauche → droite** (comme
l'OCR), pas l'ordre de placement.
