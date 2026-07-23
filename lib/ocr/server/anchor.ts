import sharp from "sharp";
import type { RowBand } from "../template";

/**
 * Ancrage des lignes par profil de projection (§4.2.3) — remplace le decoupage
 * en lignes egales ET la grille manuelle de la v1. Dans la box detectee, on
 * mesure le "contenu" de chaque ligne de pixels via le gradient horizontal moyen
 * (les lignes de texte ont beaucoup de transitions clair/sombre ; les inter-
 * lignes tres peu). On en deduit :
 *   - le NOMBRE de joueurs (4v4 / 5v5...) — plus aucun choix manuel ;
 *   - le pas entre lignes -> des bandes pleine hauteur calees sur le texte reel.
 *
 * Renvoie les bandes (RELATIVES a la box, 0–1) ou null si le profil est
 * inexploitable (le chemin image retombe alors sur un decoupage egal).
 *
 * N'importe que `sharp` + le TYPE RowBand (efface a la compilation) : reste donc
 * lisible/executable isolement par un banc.
 */

interface RelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gradient horizontal moyen par ligne de pixels de la box (extraite en gris). */
async function rowProfile(
  image: Buffer,
  left: number,
  top: number,
  width: number,
  height: number
): Promise<number[]> {
  const { data, info } = await sharp(image)
    .extract({ left, top, width, height })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const C = info.channels;
  const P = new Array<number>(H).fill(0);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W - 1; x++) {
      s += Math.abs(data[(y * W + x) * C] - data[(y * W + x + 1) * C]);
    }
    P[y] = s / (W - 1);
  }
  return P;
}

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
function contentBands(
  P: number[],
  tFrac = 0.35,
  minLenFrac = 0.05
): Array<[number, number]> {
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
 * @param box boite du tableau RELATIVE a l'image (0–1), telle que rendue par
 *            autoDetectTables.
 */
export async function anchorRows(
  image: Buffer,
  box: RelBox,
  imgW: number,
  imgH: number
): Promise<RowBand[] | null> {
  const left = Math.min(Math.max(0, Math.round(box.x * imgW)), imgW - 1);
  const top = Math.min(Math.max(0, Math.round(box.y * imgH)), imgH - 1);
  const width = Math.max(1, Math.min(Math.round(box.width * imgW), imgW - left));
  const height = Math.max(1, Math.min(Math.round(box.height * imgH), imgH - top));

  const P = smooth(
    await rowProfile(image, left, top, width, height),
    Math.max(2, Math.round(height * 0.012))
  );
  const cb = contentBands(P);
  if (cb.length < 2) return null; // profil inexploitable -> repli decoupage egal

  const H = P.length;
  const centers = cb.map(([a, b]) => (a + b) / 2 / H);
  const count = centers.length;
  // pas entre lignes (etendu sur toute la liste) -> bandes pleine hauteur, calees
  // sur le texte. Robuste aux petits decalages d'UI (§4.2).
  const step = (centers[count - 1] - centers[0]) / (count - 1);
  return centers.map((c) => ({ top: c - step / 2, height: step }));
}
