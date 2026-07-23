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
 * Cascade de lectures, la moins agressive d'abord — technique éprouvée sur les
 * polices de jeu. Aucun réglage unique ne marche partout :
 *   - sans renforcement, PSM épars : suffit quand le score est bien contrasté ;
 *   - AVEC renforcement : indispensable quand il est gris et collé au mot
 *     ("VICTOIRE5:4"), illisible autrement ;
 *   - PSM bloc : rattrape les mises en page où l'épars sépare les deux chiffres.
 */
const PASSES: Array<{ contrast: boolean; psm: PSM }> = [
  { contrast: false, psm: PSM.SPARSE_TEXT },
  { contrast: true, psm: PSM.SPARSE_TEXT },
  { contrast: false, psm: PSM.SINGLE_BLOCK },
  { contrast: true, psm: PSM.SINGLE_BLOCK },
]

function parse(text: string): RoundScore | null {
  const scored = [...text.replace(/\n/g, ' ').matchAll(SCORE_RE)]
    .map((m) => ({ blue: parseInt(m[1], 10), red: parseInt(m[2], 10) }))
    // Un score de manches CODM plafonne bas ; au-delà c'est un nombre parasite.
    .filter((s) => s.blue <= 12 && s.red <= 12 && s.blue + s.red > 0)
    .sort((a, b) => a.blue + a.red - (b.blue + b.red))
  return scored[0] ?? null
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

  for (const pass of PASSES) {
    const img = await src.crop(rect, SCALE, { contrast: pass.contrast })
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789:',
      tessedit_pageseg_mode: pass.psm,
    })
    const { data } = await worker.recognize(img, {}, { blocks: true, text: true })
    const found = parse(data.text ?? '')
    if (found) return found
  }
  return null
}
