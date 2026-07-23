import type { Mode } from "@/lib/schema";

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
  box: { x: number; y: number; width: number; height: number };
  /**
   * Lignes RELATIVES a la boite. Modele par defaut : decoupage EGAL (`top`,
   * `height`, `count`). Si `bands` est fourni (ancrage par projection), il PRIME :
   * chaque ligne prend sa bande calee sur le texte reel (chemin image serveur).
   */
  rows: { top: number; height: number; count: number; bands?: RowBand[] };
  columns: Column[];
}

export interface GameTemplate {
  game: string;
  mode: Mode;
  tables: TableTemplate[];
}

/**
 * Colonnes communes aux deux tableaux (memes proportions internes), RELATIVES a
 * la boite du tableau. Calibre sur les captures reelles CODM S&D (examples/screens) :
 * rang (0–0.14) et avatar (0.14–0.20) ignores. La disposition interne des deux
 * tableaux est symetrique (verifie : score et É/M/A tombent aux memes fractions).
 */
// Colonnes RELATIVES a la boite detectee (= etendue de la barre d'en-tete).
// Valeurs validees sur les 4 vraies captures (classees 5v5 + tournoi 4v4).
export const SND_COLUMNS: Column[] = [
  // yHeight 0.55 : ne lit que le haut de la ligne (le pseudo), pas l'etoile de
  // clan / l'embleme du bas -> supprime les caracteres parasites (@400, ®, ...).
  { field: "pseudo", type: "text", x: 0.16, width: 0.2, yHeight: 0.55 },
  // score resserre pour exclure le bouton "..." a droite du nombre (sinon les
  // petits nombres, ex. "0", se lisent mal). Non transmis a The Circle : sert a
  // l'affichage et a la verif de coherence (scores decroissants).
  { field: "score", type: "int", x: 0.4, width: 0.11 },
  { field: "ema", type: "ema", x: 0.58, width: 0.17 },
  // impact (>0.8) ignore : non utilise cote The Circle.
];
/** Construit les 2 tableaux CODM S&D a partir des boites (auto-detectees ou
 *  ajustees a la main) et du nombre de joueurs par equipe. */
export function codmSndTables(
  blueBox: TableTemplate["box"],
  redBox: TableTemplate["box"],
  count: number
): TableTemplate[] {
  const rows = { top: 0, height: 1 / count, count };
  return [
    { side: "blue", box: blueBox, rows, columns: SND_COLUMNS },
    { side: "red", box: redBox, rows, columns: SND_COLUMNS },
  ];
}

/**
 * Variante ANCREE (chemin image serveur) : chaque tableau porte ses PROPRES
 * bandes (ancrage par projection), donc son propre nombre de lignes — deduit de
 * la capture, pas choisi a la main. Remplace le decoupage egal + la grille v1.
 */
export function codmSndTablesAnchored(
  blue: { box: TableTemplate["box"]; bands: RowBand[] },
  red: { box: TableTemplate["box"]; bands: RowBand[] }
): TableTemplate[] {
  const mk = (
    side: "blue" | "red",
    box: TableTemplate["box"],
    bands: RowBand[]
  ): TableTemplate => ({
    side,
    box,
    rows: {
      top: 0,
      height: bands.length ? 1 / bands.length : 1,
      count: bands.length,
      bands,
    },
    columns: SND_COLUMNS,
  });
  return [mk("blue", blue.box, blue.bands), mk("red", red.box, red.bands)];
}

/** Template par defaut (boites approximatives ; en pratique l'auto-detection
 *  remplace les boites au chargement de l'image). count par defaut = 4. */
export const CODM_SND: GameTemplate = {
  game: "codm",
  mode: "team_deathmatch",
  tables: codmSndTables(
    { x: 0.01, y: 0.3, width: 0.49, height: 0.45 },
    { x: 0.5, y: 0.3, width: 0.49, height: 0.45 },
    4
  ),
};

/** Rectangle absolu (px) d'une cellule dans l'image, a partir du template + dims. */
export function cellRect(
  table: TableTemplate,
  rowIndex: number,
  col: { x: number; width: number; yHeight?: number },
  imgW: number,
  imgH: number
): { x: number; y: number; width: number; height: number } {
  const boxX = table.box.x * imgW;
  const boxY = table.box.y * imgH;
  const boxW = table.box.width * imgW;
  const boxH = table.box.height * imgH;

  // Ancrage par projection (bande calee sur le texte) s'il existe, sinon
  // decoupage egal (modele par defaut / chemin navigateur).
  const band = table.rows.bands?.[rowIndex];
  const relTop = band ? band.top : table.rows.top + rowIndex * table.rows.height;
  const relH = band ? band.height : table.rows.height;
  const rowTop = boxY + relTop * boxH;
  const rowH = relH * boxH;
  const yHeight = col.yHeight ?? 1;

  return {
    x: boxX + col.x * boxW,
    y: rowTop,
    width: col.width * boxW,
    height: rowH * yHeight,
  };
}
