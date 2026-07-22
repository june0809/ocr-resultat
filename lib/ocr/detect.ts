/**
 * Auto-detection des tableaux via les barres d'en-tete bleue (gauche) et rouge
 * (droite) — couleurs franches, independantes de la resolution. Donne les boites
 * X + le haut du tableau ; le bas est trouve via le profil de contenu vertical.
 *
 * Cle de robustesse : contrairement a des coordonnees relatives figees (qui ne
 * transferent pas d'une resolution/ratio a l'autre), la detection s'adapte a
 * chaque capture. Le nombre de joueurs (4 ou 5) reste choisi par l'utilisateur.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const isBlue = (r: number, g: number, b: number) =>
  b > 110 && b - r > 25 && b - g > 5 && r < 140;
const isRed = (r: number, g: number, b: number) =>
  r > 110 && r - b > 30 && r - g > 30 && b < 130;

/**
 * Detecte les deux boites de tableau (relatives 0–1). Retourne null si l'en-tete
 * bleu/rouge n'est pas trouve (capture non reconnue -> l'utilisateur aligne a la main).
 */
export function autoDetectTables(
  source: CanvasImageSource,
  imgW: number,
  imgH: number
): { blue: Box; red: Box } | null {
  const c = document.createElement("canvas");
  c.width = imgW;
  c.height = imgH;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(source, 0, 0);
  const { data } = ctx.getImageData(0, 0, imgW, imgH);
  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * imgW + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // 1) bande d'en-tete : moitie gauche tres bleue ET moitie droite tres rouge
  let hTop = -1;
  let hBot = -1;
  const half = Math.floor(imgW / 2);
  for (let y = 0; y < imgH; y++) {
    let bl = 0;
    let rd = 0;
    for (let x = 0; x < half; x++) if (isBlue(...at(x, y))) bl++;
    for (let x = half; x < imgW; x++) if (isRed(...at(x, y))) rd++;
    if (bl / half > 0.5 && rd / half > 0.4) {
      if (hTop < 0) hTop = y;
      hBot = y;
    }
  }
  if (hTop < 0) return null;

  // 2) etendue X des barres bleue et rouge (ligne mediane de l'en-tete)
  const my = Math.floor((hTop + hBot) / 2);
  let bxMin = imgW;
  let bxMax = 0;
  let rxMin = imgW;
  let rxMax = 0;
  for (let x = 0; x < imgW; x++) {
    const [r, g, b] = at(x, my);
    if (isBlue(r, g, b)) {
      bxMin = Math.min(bxMin, x);
      bxMax = Math.max(bxMax, x);
    }
    if (isRed(r, g, b)) {
      rxMin = Math.min(rxMin, x);
      rxMax = Math.max(rxMax, x);
    }
  }

  // 3) bas du tableau : derniere bande avec du contenu clair avant le trou du footer
  const bright = (x: number, y: number) => {
    const [r, g, b] = at(x, y);
    return (r + g + b) / 3 > 95;
  };
  const bandH = Math.max(2, Math.round(imgH * 0.01));
  let bottom = hBot;
  let gap = 0;
  for (let y = hBot + bandH; y < imgH * 0.9; y += bandH) {
    let cnt = 0;
    for (let x = bxMin; x < bxMax; x++) if (bright(x, y)) cnt++;
    if (cnt / Math.max(1, bxMax - bxMin) > 0.03) {
      bottom = y;
      gap = 0;
    } else {
      gap += bandH;
      if (gap > imgH * 0.05) break; // trou franc = fin du tableau
    }
  }

  const top = hBot;
  const mk = (xMin: number, xMax: number): Box => ({
    x: xMin / imgW,
    y: top / imgH,
    width: (xMax - xMin) / imgW,
    height: (bottom - top) / imgH,
  });
  return { blue: mk(bxMin, bxMax), red: mk(rxMin, rxMax) };
}
