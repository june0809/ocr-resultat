import { PSM, type Worker } from 'tesseract.js'
import { absRect, type ImageSource } from './source'

/**
 * Lecture du SCORE DE MANCHES ("2:5") affiché en haut du scoreboard.
 *
 * C'est la vérité sur le vainqueur : le nombre le plus élevé gagne, point. En
 * Recherche & Destruction, ni les kills ni le score individuel ne le déterminent
 * — seul ce score de manches compte. On évite donc de demander à l'organisateur
 * ce que la capture affiche déjà noir sur blanc.
 *
 * Le chiffre de GAUCHE est celui de l'équipe bleue (tableau de gauche), celui de
 * DROITE l'équipe rouge.
 *
 * Piège évité : la capture contient aussi un horodatage ("21:56:18"). On ne
 * retient donc que les motifs à EXACTEMENT deux groupes `N:N`, en rejetant tout
 * ce qui est entouré d'un chiffre ou d'un ':' (donc les heures à trois groupes).
 */

export interface RoundScore {
  /** manches de l'équipe bleue (tableau gauche) */
  blue: number
  /** manches de l'équipe rouge (tableau droit) */
  red: number
}

// Deux nombres séparés d'un ':', NON précédés/suivis d'un chiffre ou d'un ':'
// (ce qui écarte "21:56:18" et autres horaires).
const SCORE_RE = /(?<![\d:])(\d{1,2})\s*[:;]\s*(\d{1,2})(?![\d:])/g

/** Le score vit en HAUT À GAUCHE ; au-delà, ce sont les statistiques de fin de
 *  partie (EXP, précision…), qui n'apporteraient que du bruit. */
const LEFT_FRACTION = 0.45
const SCALE = 4

/**
 * Cascade de lectures, LA PLUS FIABLE D'ABORD. L'ordre n'est pas un détail : la
 * première passe qui rend un motif gagne, donc l'ordre décide du résultat.
 *
 * Mesuré sur 12 lectures (6 captures × 2 résolutions), score de manches connu :
 *   avec renforcement de contraste  : 22 candidats, 22 justes
 *   sans renforcement               :  8 candidats,  6 FAUX (2:7, 2:2, 4:2, 4:7)
 *
 * L'ordre précédent essayait le sans-renforcement en premier, au nom de « la
 * moins agressive d'abord » : c'est-à-dire qu'il donnait la priorité à la seule
 * passe qui se trompe. Un 4:5 lu 4:2 inverse le vainqueur, en silence.
 *
 * Les passes sans renforcement restent en dernier recours : elles rattrapent les
 * captures où le renforcement sature un score déjà très contrasté.
 */
const PASSES: Array<{ contrast: boolean; psm: PSM }> = [
  { contrast: true, psm: PSM.SPARSE_TEXT },
  { contrast: true, psm: PSM.SINGLE_BLOCK },
  { contrast: false, psm: PSM.SPARSE_TEXT },
  { contrast: false, psm: PSM.SINGLE_BLOCK },
]

/** Tous les motifs plausibles d'une passe, dans l'ordre de lecture. */
function parse(text: string): RoundScore[] {
  return [...text.replace(/\n/g, ' ').matchAll(SCORE_RE)]
    .map((m) => ({ blue: parseInt(m[1], 10), red: parseInt(m[2], 10) }))
    // Un score de manches CODM plafonne bas ; au-delà c'est un nombre parasite.
    .filter((s) => s.blue <= 12 && s.red <= 12 && s.blue + s.red > 0)
}

const key = (s: RoundScore) => `${s.blue}:${s.red}`

/**
 * Arbitrage de dernier recours, quand AUCUNE passe n'a été franche : le motif
 * vu le plus souvent gagne, à égalité celui dont le plus haut chiffre est le
 * plus élevé (une partie de Recherche & Destruction se termine quand un camp
 * atteint la limite de manches — un motif au total plus bas est du bruit).
 *
 * L'ancienne règle prenait la somme la PLUS FAIBLE, sans justification : entre
 * un vrai 4:5 et un parasite 4:2, elle retenait le parasite.
 */
function vote(all: RoundScore[]): RoundScore | null {
  const tally = new Map<string, { s: RoundScore; n: number }>()
  for (const s of all) {
    const e = tally.get(key(s))
    if (e) e.n++
    else tally.set(key(s), { s, n: 1 })
  }
  const ranked = [...tally.values()].sort(
    (a, b) =>
      b.n - a.n ||
      Math.max(b.s.blue, b.s.red) - Math.max(a.s.blue, a.s.red) ||
      b.s.blue + b.s.red - (a.s.blue + a.s.red)
  )
  return ranked[0]?.s ?? null
}

export async function readRoundScore(
  worker: Worker,
  src: ImageSource,
  /** Y (fraction de l'image) du haut de la barre d'en-tête : la bande à lire va
   *  du haut de l'image jusque-là. */
  headerTopY: number
): Promise<RoundScore | null> {
  const bottom = Math.max(0.02, Math.min(0.9, headerTopY))
  const rect = absRect(
    { x: 0, y: 0, width: LEFT_FRACTION, height: bottom },
    src.width,
    src.height
  )

  // On s'arrête à la première passe FRANCHE : un seul motif plausible, donc rien
  // à arbitrer. Une passe qui en rend plusieurs est ambiguë — on ne devine pas,
  // on essaie la suivante, et on ne tranche au vote que si aucune n'est franche.
  const seen: RoundScore[] = []
  for (const pass of PASSES) {
    const img = await src.crop(rect, SCALE, { contrast: pass.contrast })
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789:',
      tessedit_pageseg_mode: pass.psm,
    })
    const { data } = await worker.recognize(img, {}, { blocks: true, text: true })
    const found = parse(data.text ?? '')
    seen.push(...found)
    const distinct = new Set(found.map(key))
    if (distinct.size === 1) return found[0]
  }
  return vote(seen)
}
