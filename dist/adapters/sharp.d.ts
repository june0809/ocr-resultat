import { type ImageSource } from "../core/source";
/**
 * Adaptateur SERVEUR (Node) — pixels via sharp.
 * Ne contient AUCUN algorithme : uniquement la traduction "donne-moi ces
 * pixels". Voir core/source.ts pour le pourquoi.
 */
export declare function createSharpSource(image: Buffer): Promise<ImageSource>;
//# sourceMappingURL=sharp.d.ts.map