import { absRect, type ImageSource, type RelBox } from "./source";
import type { RowBand } from "../template";

/**
 * Ancrage des LIGNES par profil de projection — remplace le decoupage en lignes
 * egales ET la grille manuelle.
 *
 * Dans la boite detectee, on mesure le "contenu" de chaque ligne de pixels via
 * le gradient horizontal moyen : une ligne de texte enchaine les transitions
 * clair/sombre, un interligne quasiment aucune. On en deduit :
 *   - le NOMBRE de joueurs (4v4 / 5v5...) — plus aucun choix manuel ;
 *   - le pas entre lignes -> des bandes calees sur le texte reel.
 *
 * Partage Node/navigateur : ne touche aux pixels qu'a travers ImageSource.
 */

/** Bornes plausibles du nombre de joueurs par equipe (2v2 a 10v10). Hors de
 *  cette plage, le profil a capte autre chose que des lignes de joueurs. */
const MIN_ROWS = 2;
const MAX_ROWS = 10;
/** Ecart maximal tolere entre deux interlignes consecutifs et l'interligne
 *  moyen. Des lignes de joueurs sont REGULIEREMENT espacees ; une bande
 *  parasite (reste d'en-tete, trait de footer) casse cette regularite. */
const MAX_STEP_DEVIATION = 0.35;

/** Moyenne glissante (fenetre +/- win) pour lisser le profil. */
function smooth(P: number[], win: number): number[] {
  const H = P.length;
  const out = new Array<number>(H).fill(0);
  for (let y = 0; y < H; y++) {
    let s = 0;
    let n = 0;
    for (let k = -win; k <= win; k++) {
      const j = y + k;
      if (j >= 0 && j < H) {
        s += P[j];
        n++;
      }
    }
    out[y] = s / n;
  }
  return out;
}

/** Bandes de contenu = suites contigues au-dessus d'un seuil relatif. */
function contentBands(P: number[], tFrac = 0.35, minLenFrac = 0.05): Array<[number, number]> {
  const H = P.length;
  let min = Infinity;
  let max = -Infinity;
  for (const v of P) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const T = min + tFrac * (max - min);
  const minLen = Math.max(1, Math.round(H * minLenFrac));
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let y = 0; y < H; y++) {
    if (P[y] > T) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      if (y - start >= minLen) out.push([start, y]);
      start = -1;
    }
  }
  if (start >= 0 && H - start >= minLen) out.push([start, H]);
  return out;
}

/**
 * @param box boite du tableau RELATIVE a l'image, telle que rendue par
 *            autoDetectTables (la partie `body`).
 * @returns les bandes RELATIVES a la boite, ou null si le profil est
 *          inexploitable / manifestement faux.
 */
export async function anchorRows(src: ImageSource, box: RelBox): Promise<RowBand[] | null> {
  const r = absRect(box, src.width, src.height);
  const { data, width: W, height: H, channels: C } = await src.grey(r);

  // gradient horizontal moyen par ligne de pixels
  const P0 = new Array<number>(H).fill(0);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W - 1; x++) {
      s += Math.abs(data[(y * W + x) * C] - data[(y * W + x + 1) * C]);
    }
    P0[y] = s / Math.max(1, W - 1);
  }

  const P = smooth(P0, Math.max(2, Math.round(H * 0.012)));
  const cb = contentBands(P);
  if (cb.length < 2) return null;

  const centers = cb.map(([a, b]) => (a + b) / 2 / P.length);
  const count = centers.length;

  // Garde-fou 1 : nombre de lignes plausible. Sans ca, un profil parasite
  // produit un tableau DECALE mais d'apparence valide — l'erreur la plus
  // dangereuse, car elle passe la validation humaine sans alerter.
  if (count < MIN_ROWS || count > MAX_ROWS) return null;

  const step = (centers[count - 1] - centers[0]) / (count - 1);
  if (!(step > 0)) return null;

  // Garde-fou 2 : regularite de l'interligne.
  for (let i = 1; i < count; i++) {
    const gap = centers[i] - centers[i - 1];
    if (Math.abs(gap - step) / step > MAX_STEP_DEVIATION) return null;
  }

  return centers.map((c) => ({ top: c - step / 2, height: step }));
}
