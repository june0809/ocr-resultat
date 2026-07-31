import { type ImageSource } from "../core/source";
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
/**
 * @param source image deja chargee (HTMLImageElement decode, ImageBitmap...).
 * @param width  largeur NATIVE de l'image (naturalWidth), pas sa taille affichee.
 */
export declare function createCanvasSource(source: Drawable, width: number, height: number): ImageSource;
export {};
//# sourceMappingURL=canvas.d.ts.map