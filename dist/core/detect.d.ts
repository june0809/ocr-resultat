import type { ImageSource, RelBox } from "./source";
/**
 * Detection auto des tableaux CODM (equipe bleue a gauche, rouge a droite) via
 * les barres d'en-tete de couleur.
 *
 * Cle de robustesse : on ne fige AUCUNE coordonnee relative (elles ne
 * transferent pas d'une resolution ni d'un ratio a l'autre — un iPad et un
 * telephone n'ont pas la meme mise en page). La detection s'adapte a chaque
 * capture en cherchant deux aplats de couleur franche.
 *
 * Partage Node/navigateur : ne touche aux pixels qu'a travers ImageSource.
 */
/** Boites d'un tableau : zone des joueurs + barre d'en-tete au-dessus.
 *  L'en-tete porte les libelles de colonnes ("JOUEUR / SCORE / É/M/A / IMPACT"),
 *  ecrits dans une police d'INTERFACE nette sur un aplat uni : c'est le meilleur
 *  ancrage de colonnes disponible (cf. core/columns.ts). */
export interface TableBoxes {
    body: RelBox;
    header: RelBox;
}
/**
 * Renvoie les deux tableaux, ou null si l'en-tete bleu/rouge est introuvable
 * (capture non reconnue -> l'appelant remonte une erreur exploitable).
 */
export declare function autoDetectTables(src: ImageSource): Promise<{
    blue: TableBoxes;
    red: TableBoxes;
} | null>;
//# sourceMappingURL=detect.d.ts.map