import { PSM, type Worker } from "tesseract.js";
import { absRect, type ImageSource } from "./source";
import { detectColumns } from "./columns";
import { cellRect, type Column, type GameTemplate } from "../template";
import { cleanPseudo } from "../pseudo";

/**
 * Lecture du scoreboard, cellule par cellule.
 *
 * On ne fait JAMAIS d'OCR plein cadre : les polices stylisees sur fond
 * translucide donnent de la bouillie. Chaque cellule est decoupee via le
 * template puis lue au bon mode (chiffres -> whitelist, pseudo -> texte libre).
 *
 * Partage Node/navigateur : les pixels passent par ImageSource, le moteur par
 * un Worker tesseract fourni par l'appelant (qui sait, lui, ou trouver la
 * traineddata sur sa plateforme).
 */

export interface OcrCell {
  text: string;
  /** 0.0–1.0 (tesseract rend 0–100, converti ici). */
  confidence: number;
}

export interface OcrPlayer {
  pseudo: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: number | null;
  /** MVP = 1re ligne (board trie par score decroissant). Corrigible cote UI. */
  is_mvp: boolean;
  /** confiance des STATS (cellule K/D/A) : alimente la confiance globale + 422. */
  confidence: number;
  /** confiance de lecture du pseudo : warning + surlignage, jamais le 422. */
  pseudo_confidence: number;
  cells: { pseudo: OcrCell; score: OcrCell; ema: OcrCell };
}

export interface OcrTeam {
  side: "blue" | "red";
  players: OcrPlayer[];
}

export interface OcrResult {
  teams: OcrTeam[];
}

/** Agrandissement des extraits de cellule avant lecture. */
const CELL_SCALE = 3;

const WHITELIST: Record<Column["type"], string> = {
  text: "",
  int: "0123456789",
  ema: "0123456789/",
};

/** "15/7/0" (avec bruit OCR) -> {kills,deaths,assists} : 3 premiers nombres. */
export function parseEma(raw: string): {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
} {
  const nums = (raw.match(/\d+/g) ?? []).map((n) => parseInt(n, 10));
  return { kills: nums[0] ?? null, deaths: nums[1] ?? null, assists: nums[2] ?? null };
}

/** Extrait un entier d'une chaine OCR bruitee ("SCORE 240" -> 240). */
export function parseInt0(raw: string): number | null {
  const m = raw.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Regle le moteur pour un TYPE de colonne. A appeler le moins souvent
 *  possible : un changement de parametres force tesseract a se reinitialiser,
 *  ce qui coute bien plus cher que la reconnaissance elle-meme sur un CPU
 *  contraint. D'ou la boucle "colonne d'abord" de runOcr. */
async function setCellParams(worker: Worker, type: Column["type"]): Promise<void> {
  await worker.setParameters({
    tessedit_char_whitelist: WHITELIST[type],
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
  });
}

export interface RunOcrOptions {
  /** Trace les colonnes detectees (diagnostic). */
  onDebug?: (message: string) => void;
}

export async function runOcr(
  worker: Worker,
  src: ImageSource,
  template: GameTemplate,
  opts: RunOcrOptions = {}
): Promise<OcrResult> {
  const teams: OcrTeam[] = [];

  for (const table of template.tables) {
    const rowCount = table.rows.bands?.length ?? table.rows.count;

    // ── Colonnes : detectees sur la capture, jamais codees en dur ───────────
    // CODM refond sa mise en page selon le ratio de l'ecran (cf. core/columns).
    // Repli sur les fractions du template si le reperage echoue.
    let columns: Column[] = table.columns;
    if (table.rows.bands?.length && table.header) {
      const detected = await detectColumns(
        worker,
        src,
        { body: table.box, header: table.header },
        table.rows.bands
      );
      if (detected) columns = detected.columns;
      opts.onDebug?.(
        `[cols ${table.side}] ` +
          (detected ? detected.detail : "NON DETECTE -> fractions par defaut")
      );
    }

    // Boucle COLONNE d'abord, puis lignes : les parametres du moteur ne
    // changent qu'a chaque colonne (3 fois) au lieu de chaque cellule (~40).
    const grid: Array<Record<string, OcrCell>> = Array.from({ length: rowCount }, () => ({}));
    for (const col of columns) {
      await setCellParams(worker, col.type);
      for (let row = 0; row < rowCount; row++) {
        const rect = absRect(
          normalize(cellRect(table, row, col, src.width, src.height), src.width, src.height),
          src.width,
          src.height
        );
        const img = await src.crop(rect, CELL_SCALE);
        const { data } = await worker.recognize(img);
        grid[row][col.field] = {
          text: data.text.trim().replace(/\s+/g, col.type === "text" ? " " : ""),
          confidence: Math.max(0, Math.min(1, data.confidence / 100)),
        };
      }
    }

    const players: OcrPlayer[] = [];
    for (let row = 0; row < rowCount; row++) {
      const byField = grid[row];
      const pseudoCell = byField.pseudo ?? { text: "", confidence: 0 };
      const scoreCell = byField.score ?? { text: "", confidence: 0 };
      const emaCell = byField.ema ?? { text: "", confidence: 0 };
      const ema = parseEma(emaCell.text);

      players.push({
        // surnom "(Paul)" retire : libelle d'interface, pas le pseudo en jeu.
        pseudo: cleanPseudo(pseudoCell.text),
        kills: ema.kills,
        deaths: ema.deaths,
        assists: ema.assists,
        score: parseInt0(scoreCell.text),
        is_mvp: row === 0, // board trie par score -> 1re ligne = MVP
        // confiance des STATS = cellule K/D/A. Le score et le pseudo n'entrent
        // pas ici, pour ne pas faire rejeter un match aux stats parfaites mais
        // au pseudo stylise.
        confidence: emaCell.confidence,
        pseudo_confidence: pseudoCell.confidence,
        cells: { pseudo: pseudoCell, score: scoreCell, ema: emaCell },
      });
    }

    teams.push({ side: table.side, players });
  }

  return { teams };
}

/** cellRect rend deja des pixels absolus ; on repasse par une zone relative
 *  pour reutiliser le bornage commun. */
function normalize(
  rect: { x: number; y: number; width: number; height: number },
  imgW: number,
  imgH: number
) {
  return { x: rect.x / imgW, y: rect.y / imgH, width: rect.width / imgW, height: rect.height / imgH };
}
