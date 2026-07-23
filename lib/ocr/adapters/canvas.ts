import { clampRect, type ImageSource, type OcrImage, type Raster, type Rect } from "../core/source";

/**
 * Adaptateur NAVIGATEUR — pixels via canvas 2D.
 * Ne contient AUCUN algorithme : uniquement la traduction "donne-moi ces
 * pixels". Le pretraitement (agrandissement, gris, normalisation min/max)
 * reproduit exactement celui de l'adaptateur sharp, sinon le banc headless ne
 * dirait plus la verite sur ce que voit l'utilisateur.
 */

/** Tout ce que drawImage sait dessiner (img, canvas, ImageBitmap, video).
 *  Les dimensions natives sont passees a part : selon le type, la propriete qui
 *  les porte differe (naturalWidth, videoWidth, width...). */
type Drawable = CanvasImageSource;

function ctxOf(width: number, height: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2D indisponible");
  return ctx;
}

/**
 * @param source image deja chargee (HTMLImageElement decode, ImageBitmap...).
 * @param width  largeur NATIVE de l'image (naturalWidth), pas sa taille affichee.
 */
export function createCanvasSource(
  source: Drawable,
  width: number,
  height: number
): ImageSource {
  if (width < 2 || height < 2) throw new Error("dimensions image invalides");

  return {
    width,
    height,

    async rgba(): Promise<Raster> {
      const ctx = ctxOf(width, height);
      ctx.drawImage(source, 0, 0);
      const img = ctx.getImageData(0, 0, width, height);
      return { data: img.data, width, height, channels: 4 };
    },

    async grey(rect: Rect): Promise<Raster> {
      const r = clampRect(rect, width, height);
      const ctx = ctxOf(r.width, r.height);
      ctx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
      const img = ctx.getImageData(0, 0, r.width, r.height);
      const d = img.data;
      // On rend un raster 4 canaux dont le canal 0 porte le gris : meme
      // convention d'indexation que sharp (les lecteurs lisent data[i*channels]).
      for (let i = 0; i < d.length; i += 4) {
        const y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        d[i] = d[i + 1] = d[i + 2] = y;
      }
      return { data: d, width: r.width, height: r.height, channels: 4 };
    },

    async crop(rect: Rect, scale: number): Promise<OcrImage> {
      const r = clampRect(rect, width, height);
      const ctx = ctxOf(r.width * scale, r.height * scale);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, ctx.canvas.width, ctx.canvas.height);

      const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      const d = img.data;
      let min = 255;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        d[i] = d[i + 1] = d[i + 2] = y;
        if (y < min) min = y;
        if (y > max) max = y;
      }
      // Etirement de contraste min/max — equivalent de sharp.normalize().
      const range = max - min || 1;
      for (let i = 0; i < d.length; i += 4) {
        const v = ((d[i] - min) / range) * 255;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
      return ctx.canvas as unknown as OcrImage;
    },
  };
}
