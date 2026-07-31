import { type Worker } from 'tesseract.js';
import { type ImageSource } from './source';
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
    blue: number;
    /** manches de l'équipe rouge (tableau droit) */
    red: number;
}
export declare function readRoundScore(worker: Worker, src: ImageSource, 
/** Y (fraction de l'image) du haut de la barre d'en-tête : la bande à lire va
 *  du haut de l'image jusque-là. */
headerTopY: number): Promise<RoundScore | null>;
//# sourceMappingURL=roundscore.d.ts.map