/** Mode de partie. Redefini ici plutot qu'importe de lib/schema : le moteur est
 *  consomme comme une bibliotheque par d'autres applications (The Circle), et
 *  ne doit donc dependre ni de zod ni des alias "@/" de cette appli Next. */
export type Mode = "battle_royale" | "team_deathmatch" | "free_for_all";
/**
 * Template de jeu — decrit OU se trouve chaque colonne, en coordonnees RELATIVES
 * (0.0–1.0) pour tolerer les resolutions (SPEC §5.1).
 *
 * CODM Recherche & Destruction = team_deathmatch, 5v5, 2 tableaux cote a cote
 * (equipe bleue a gauche, rouge a droite). Par ligne :
 *   rang · avatar · JOUEUR (pseudo) · SCORE · É/M/A · IMPACT
 * La colonne É/M/A est fusionnee (ex. "15/7/0") -> decoupee en kills/deaths/assists
 * par le pipeline.
 *
 * ⚠️ Les valeurs ci-dessous sont des DEFAUTS a calibrer sur les vraies captures.
 * L'outil d'alignement de la page d'upload permet a l'utilisateur d'ajuster la
 * boite de chaque tableau visuellement : la calibration exacte n'est donc pas
 * bloquante, ces defauts servent de point de depart.
 */
export type FieldType = "text" | "int" | "ema";
export type FieldName = "pseudo" | "score" | "ema" | "impact";
export interface Column {
    field: FieldName;
    type: FieldType;
    /** x et largeur RELATIFS a la boite du tableau (0–1). */
    x: number;
    width: number;
    /** hauteur RELATIVE a la ligne (0–1). Defaut 1. Le pseudo n'occupe que le HAUT
     *  de la ligne (le bas contient l'etoile/embleme de clan a exclure). */
    yHeight?: number;
}
/** Une bande de ligne (1 joueur), RELATIVE a la boite du tableau (0–1). Produite
 *  par l'ancrage par projection (lib/ocr/server/anchor.ts, §4.2.3). */
export interface RowBand {
    top: number;
    height: number;
}
export interface TableTemplate {
    side: "blue" | "red";
    /** Boite du tableau, RELATIVE a l'image entiere (0–1). Ajustee par l'alignement. */
    box: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Barre d'en-tete ("JOUEUR / SCORE / É/M/A / IMPACT"), RELATIVE a l'image.
     *  Sert d'ancrage principal pour la detection des colonnes (chemin serveur). */
    header?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /**
     * Lignes RELATIVES a la boite. Modele par defaut : decoupage EGAL (`top`,
     * `height`, `count`). Si `bands` est fourni (ancrage par projection), il PRIME :
     * chaque ligne prend sa bande calee sur le texte reel (chemin image serveur).
     */
    rows: {
        top: number;
        height: number;
        count: number;
        bands?: RowBand[];
    };
    columns: Column[];
}
export interface GameTemplate {
    game: string;
    mode: Mode;
    tables: TableTemplate[];
}
/**
 * Colonnes communes aux deux tableaux (memes proportions internes), RELATIVES a
 * la boite du tableau (= etendue de la barre d'en-tete detectee).
 *
 * CALIBRE AU PIXEL sur les vraies captures (scripts/calib-dump.ts pose une regle
 * en % sur la boite detectee). Reperes mesures, en % de la largeur de boite :
 *
 *   0–9    medaillon de rang (1/2/3, ou chiffre nu)
 *   10–20.5 avatar (portrait du joueur)
 *   22–27  embleme de clan / rang  <- dans le BAS de la ligne (exclu par yHeight)
 *   23.6–37 PSEUDO
 *   37.5–42 bouton ami / inviter   <- a exclure imperativement
 *   43.5–50 badge MVP (1re ligne seulement)
 *   50–57  SCORE
 *   58–62  bouton "..."            <- a exclure
 *   65–73.5 K/D/A
 *   84–89  impact (non utilise)
 *
 * La calibration precedente (pseudo 16–36 %) DEMARRAIT DANS L'AVATAR : le bord
 * du portrait produisait le bruit de tete recurrent ("nN ", "By | ", "= ", "> ")
 * et le pseudo etait tronque a droite ("AZ-Alk_pc(Pau"). Le score (40–51 %) ne
 * couvrait meme pas le nombre : il lisait le bouton ami et le badge MVP.
 */
export declare const SND_COLUMNS: Column[];
/** Construit les 2 tableaux CODM S&D a partir des boites (auto-detectees ou
 *  ajustees a la main) et du nombre de joueurs par equipe. */
export declare function codmSndTables(blueBox: TableTemplate["box"], redBox: TableTemplate["box"], count: number): TableTemplate[];
/**
 * Variante ANCREE (chemin image serveur) : chaque tableau porte ses PROPRES
 * bandes (ancrage par projection), donc son propre nombre de lignes — deduit de
 * la capture, pas choisi a la main. Remplace le decoupage egal + la grille v1.
 */
export declare function codmSndTablesAnchored(blue: {
    box: TableTemplate["box"];
    header?: TableTemplate["header"];
    bands: RowBand[];
}, red: {
    box: TableTemplate["box"];
    header?: TableTemplate["header"];
    bands: RowBand[];
}): TableTemplate[];
/** Template par defaut (boites approximatives ; en pratique l'auto-detection
 *  remplace les boites au chargement de l'image). count par defaut = 4. */
export declare const CODM_SND: GameTemplate;
/** Rectangle absolu (px) d'une cellule dans l'image, a partir du template + dims. */
export declare function cellRect(table: TableTemplate, rowIndex: number, col: {
    x: number;
    width: number;
    yHeight?: number;
}, imgW: number, imgH: number): {
    x: number;
    y: number;
    width: number;
    height: number;
};
//# sourceMappingURL=template.d.ts.map