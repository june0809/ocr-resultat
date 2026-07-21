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

/** Colonnes communes aux deux tableaux (memes proportions internes). */
const SND_COLUMNS: Column[] = [
  // rang (0–0.10) et avatar (0.10–0.22) ignores : non lus.
  { field: "pseudo", type: "text", x: 0.22, width: 0.40 },
  { field: "score", type: "int", x: 0.62, width: 0.14 },
  { field: "ema", type: "ema", x: 0.76, width: 0.16 },
  // impact (0.92–1.0) ignore par defaut.
];

const SND_ROWS = { top: 0.0, height: 0.2, count: 5 };

export const CODM_SND: GameTemplate = {
  game: "codm",
  mode: "team_deathmatch",
  tables: [
    {
      side: "blue",
      box: { x: 0.05, y: 0.28, width: 0.42, height: 0.5 },
      rows: SND_ROWS,
      columns: SND_COLUMNS,
    },
    {
      side: "red",
      box: { x: 0.53, y: 0.28, width: 0.42, height: 0.5 },
      rows: SND_ROWS,
      columns: SND_COLUMNS,
    },
  ],
};

/** Rectangle absolu (px) d'une cellule dans l'image, a partir du template + dims. */
export function cellRect(
  table: TableTemplate,
  rowIndex: number,
  col: Column,
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
