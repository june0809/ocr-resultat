import type { Worker } from "tesseract.js";

/**
 * FRONTIERE PLATEFORME — le seul endroit du moteur qui sait d'ou viennent les
 * pixels.
 *
 * Les algorithmes (detection des tableaux, ancrage des lignes, detection des
 * colonnes, lecture des cellules) sont RIGOUREUSEMENT identiques en Node et
 * dans le navigateur. Seules trois operations different :
 *   - decoder l'image et acceder aux pixels bruts,
 *   - extraire une sous-zone en niveaux de gris,
 *   - produire un extrait pretraite que tesseract sait consommer.
 *
 * On les isole donc derriere cette interface, avec deux implementations minces
 * (adapters/sharp.ts et adapters/canvas.ts). Tout le reste est partage.
 *
 * Pourquoi ca compte : le repo portait deja detect.ts et pipeline.ts en DOUBLE
 * (une version canvas, une version sharp). Les deux ont derive — le mode PSM
 * n'avait ete corrige que d'un cote, et la detection des colonnes n'existait que
 * cote serveur. Une seule implementation supprime la classe de bug entiere.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Zone en coordonnees RELATIVES a l'image entiere (0–1). */
export interface RelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixels bruts + geometrie. `channels` = octets par pixel (4 en RGBA, 1 en gris). */
export interface Raster {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: number;
}

/** Ce que tesseract.js accepte en entree (Buffer en Node, canvas en navigateur). */
export type OcrImage = Parameters<Worker["recognize"]>[0];

export interface ImageSource {
  readonly width: number;
  readonly height: number;

  /** Pixels de l'image entiere en RGBA (4 canaux). Sert a la detection des
   *  barres d'en-tete, qui raisonne sur la COULEUR. */
  rgba(): Promise<Raster>;

  /** Sous-zone en niveaux de gris (1 canal utile). Sert aux profils de
   *  projection, qui ne raisonnent que sur l'intensite. */
  grey(rect: Rect): Promise<Raster>;

  /**
   * Extrait pretraite, pret pour tesseract : recadre, agrandi xN, niveaux de
   * gris, contraste normalise (etirement min/max).
   *
   * C'est LA recette qui fait la fiabilite de lecture sur les polices de jeu —
   * elle doit rester identique des deux cotes, sinon le banc ne dit plus la
   * verite sur ce que verra l'utilisateur.
   */
  crop(rect: Rect, scale: number): Promise<OcrImage>;
}

/** Borne un rectangle a l'interieur de l'image (evite les extractions hors cadre). */
export function clampRect(rect: Rect, imgW: number, imgH: number): Rect {
  const x = Math.min(Math.max(0, Math.round(rect.x)), Math.max(0, imgW - 1));
  const y = Math.min(Math.max(0, Math.round(rect.y)), Math.max(0, imgH - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(rect.width), imgW - x)),
    height: Math.max(1, Math.min(Math.round(rect.height), imgH - y)),
  };
}

/** Rectangle absolu (px) d'une zone relative. */
export function absRect(box: RelBox, imgW: number, imgH: number): Rect {
  return clampRect(
    { x: box.x * imgW, y: box.y * imgH, width: box.width * imgW, height: box.height * imgH },
    imgW,
    imgH
  );
}
