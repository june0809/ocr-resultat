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
}

export interface TableTemplate {
  side: "blue" | "red";
  /** Boite du tableau, RELATIVE a l'image entiere (0–1). Ajustee par l'alignement. */
  box: { x: number; y: number; width: number; height: number };
  /** Lignes, RELATIVES a la boite : 1re ligne a `top`, chacune de hauteur `height`. */
  rows: { top: number; height: number; count: number };
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
  { field: "pseudo", type: "text", x: 0.16, width: 0.2 },
  { field: "score", type: "int", x: 0.42, width: 0.15 },
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
  col: { x: number; width: number },
  imgW: number,
  imgH: number
): { x: number; y: number; width: number; height: number } {
  const boxX = table.box.x * imgW;
  const boxY = table.box.y * imgH;
  const boxW = table.box.width * imgW;
  const boxH = table.box.height * imgH;

  const rowTop = boxY + (table.rows.top + rowIndex * table.rows.height) * boxH;
  const rowH = table.rows.height * boxH;

  return {
    x: boxX + col.x * boxW,
    y: rowTop,
    width: col.width * boxW,
    height: rowH,
  };
}
