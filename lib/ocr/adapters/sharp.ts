import sharp from "sharp";
import { clampRect, type ImageSource, type OcrImage, type Raster, type Rect } from "../core/source";

/**
 * Adaptateur SERVEUR (Node) — pixels via sharp.
 * Ne contient AUCUN algorithme : uniquement la traduction "donne-moi ces
 * pixels". Voir core/source.ts pour le pourquoi.
 */

export async function createSharpSource(image: Buffer): Promise<ImageSource> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 2 || height < 2) throw new Error("dimensions image invalides");

  return {
    width,
    height,

    async rgba(): Promise<Raster> {
      // ensureAlpha() force 4 canaux : l'indexation des pixels est alors la
      // meme que celle d'un canvas navigateur (stride de 4).
      const { data, info } = await sharp(image)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height, channels: info.channels };
    },

    async grey(rect: Rect): Promise<Raster> {
      const r = clampRect(rect, width, height);
      const { data, info } = await sharp(image)
        .extract({ left: r.x, top: r.y, width: r.width, height: r.height })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height, channels: info.channels };
    },

    async crop(rect: Rect, scale: number): Promise<OcrImage> {
      const r = clampRect(rect, width, height);
      return sharp(image)
        .extract({ left: r.x, top: r.y, width: r.width, height: r.height })
        .resize({ width: Math.max(1, Math.round(r.width * scale)) })
        .grayscale()
        .normalize()
        .png()
        .toBuffer() as unknown as OcrImage;
    },
  };
}
