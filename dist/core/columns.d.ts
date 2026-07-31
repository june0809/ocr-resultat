import { type Worker } from "tesseract.js";
import { type ImageSource, type RelBox } from "./source";
import type { Column, RowBand } from "../template";
/**
 * DETECTION AUTOMATIQUE DES COLONNES.
 *
 * Pourquoi ce module existe : des fractions de colonnes figees ne transferent
 * PAS d'un appareil a l'autre. Mesure sur les vraies captures :
 *
 *             pseudo        score        K/D/A
 *   iPad      23.6–37 %     50–57 %      65–73.5 %   (2420x1668, ratio 1.45)
 *   telephone 18.6–26 %     44.9–49.5 %  61.8–68.5 % (1600x720,  ratio 2.22)
 *
 * CODM ne se contente pas de redimensionner : il REFOND sa mise en page selon
 * le ratio de l'ecran. Toute constante calibree sur un appareil casse sur
 * l'autre.
 *
 * Strategie : on identifie les colonnes par leur CONTENU, pas leur position.
 *   Ancrage 1 (principal) — les LIBELLES DE L'EN-TETE. Amorcer la geometrie sur
 *     l'OCR des lignes de joueurs serait circulaire : ce sont justement les
 *     pseudos stylises que Tesseract lit mal. L'en-tete, lui, est ecrit dans la
 *     police d'interface, en majuscules, sur un aplat uni : la zone la plus
 *     lisible de toute la capture, et elle definit les colonnes par construction.
 *   Ancrage 2 (repli) — la signature "15/5/0" du K/D/A, qu'aucun autre element
 *     du scoreboard ne peut imiter. Cherchee a la whitelist chiffres+slash sur
 *     la moitie droite, ou l'avatar ne peut pas polluer.
 *   Pseudo — fenetre calee sur le score (l'ECART est stable d'un appareil a
 *     l'autre, contrairement aux positions absolues), puis affinee par OCR sur
 *     le premier groupe de mots contigus.
 */
export interface DetectedColumns {
    columns: Column[];
    /** Diagnostic (OCR_DEBUG) : d'ou viennent les bornes. */
    detail: string;
}
/**
 * Repere les colonnes. Renvoie null si ni l'en-tete ni le K/D/A ne sont
 * exploitables (l'appelant retombe alors sur les fractions par defaut).
 */
export declare function detectColumns(worker: Worker, src: ImageSource, boxes: {
    body: RelBox;
    header: RelBox;
}, bands: RowBand[]): Promise<DetectedColumns | null>;
//# sourceMappingURL=columns.d.ts.map