import { createWorker, type Worker } from "tesseract.js";
import { cellRect, type Column, type GameTemplate } from "./template";

/**
 * Pipeline OCR navigateur (SPEC §5). Tourne cote CLIENT uniquement (canvas + WASM).
 * On ne fait JAMAIS d'OCR plein cadre : on decoupe chaque cellule via le template
 * et on lance Tesseract case par case, avec le bon mode (chiffres -> whitelist).
 * L'image ne quitte pas l'appareil.
 */

export interface OcrCell {
  text: string;
  /** 0.0–1.0 (Tesseract renvoie 0–100, converti ici). */
  confidence: number;
}

export interface OcrPlayer {
  pseudo: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: number | null;
  /** MVP detecte par le badge (dore/argente). Un seul par equipe. */
  is_mvp: boolean;
  /** confiance des STATS (cellule É/M/A) : alimente la confiance globale + 422. */
  confidence: number;
  /** confiance de lecture du pseudo : sert au warning, jamais au 422. */
  pseudo_confidence: number;
  /** dataURL de la bande d'image de la ligne (verif visuelle image -> JSON). */
  rowImage: string;
  cells: { pseudo: OcrCell; score: OcrCell; ema: OcrCell };
}

export interface OcrTeam {
  side: "blue" | "red";
  players: OcrPlayer[];
}

export interface OcrResult {
  teams: OcrTeam[];
}

export type ProgressCb = (done: number, total: number) => void;

/** "15/7/0" (avec bruit OCR) -> {kills,deaths,assists}. Prend les 3 1ers nombres. */
export function parseEma(raw: string): {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
} {
  const nums = (raw.match(/\d+/g) ?? []).map((n) => parseInt(n, 10));
  return {
    kills: nums[0] ?? null,
    deaths: nums[1] ?? null,
    assists: nums[2] ?? null,
  };
}

/** Extrait un entier d'une chaine OCR bruitee ("SCORE 240" -> 240). */
export function parseInt0(raw: string): number | null {
  const m = raw.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Decoupe une cellule, l'agrandit x3, puis niveaux de gris + normalisation min/max.
 * Recette validee pour la lecture des K/D/A (donnee transmise). Meme pretraitement
 * reproduit dans le banc headless (scripts/ocr-e2e.mjs) pour un banc fidele.
 */
function cropCell(
  source: CanvasImageSource,
  rect: { x: number; y: number; width: number; height: number }
): HTMLCanvasElement {
  const scale = 3;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(rect.width * scale));
  c.height = Math.max(1, Math.round(rect.height * scale));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, c.width, c.height);

  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    d[i] = d[i + 1] = d[i + 2] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const range = max - min || 1;
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Bande d'image d'une ligne (couleur, sans pretraitement), en dataURL PNG. */
function rowImageUrl(
  source: CanvasImageSource,
  rect: { x: number; y: number; width: number; height: number }
): string {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(rect.width));
  c.height = Math.max(1, Math.round(rect.height));
  const ctx = c.getContext("2d")!;
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

const WHITELIST: Record<Column["type"], string> = {
  text: "",
  int: "0123456789",
  ema: "0123456789/",
};

// MVP : le scoreboard CODM est trie par score decroissant et le badge MVP va au
// meilleur score -> le MVP est la 1re ligne de chaque equipe. Repere plus robuste
// que la couleur du badge (dont la position relative varie selon la resolution, et
// que les medaillons de rang/etoiles parasitent). Le dore/argente (gagnant/perdant)
// se deduit du placement cote The Circle.

async function recognizeCell(
  worker: Worker,
  canvas: HTMLCanvasElement,
  type: Column["type"]
): Promise<OcrCell> {
  await worker.setParameters({
    tessedit_char_whitelist: WHITELIST[type],
  });
  const { data } = await worker.recognize(canvas);
  return {
    text: data.text.trim().replace(/\s+/g, type === "text" ? " " : ""),
    confidence: Math.max(0, Math.min(1, data.confidence / 100)),
  };
}

/**
 * Lance l'OCR sur toute la grille alignee. `template` doit deja porter les boites
 * ajustees par l'outil d'alignement. `imgW/imgH` = dimensions natives de l'image.
 */
export async function runOcr(
  source: CanvasImageSource,
  imgW: number,
  imgH: number,
  template: GameTemplate,
  onProgress?: ProgressCb
): Promise<OcrResult> {
  const worker = await createWorker("eng");
  try {
    const cols = template.tables[0].columns;
    const total =
      template.tables.length * template.tables[0].rows.count * cols.length;
    let done = 0;

    const teams: OcrTeam[] = [];

    for (const table of template.tables) {
      const players: OcrPlayer[] = [];

      for (let row = 0; row < table.rows.count; row++) {
        const byField: Record<string, OcrCell> = {};

        for (const col of table.columns) {
          const rect = cellRect(table, row, col, imgW, imgH);
          const cell = await recognizeCell(worker, cropCell(source, rect), col.type);
          byField[col.field] = cell;
          onProgress?.(++done, total);
        }

        const pseudoCell = byField.pseudo ?? { text: "", confidence: 0 };
        const scoreCell = byField.score ?? { text: "", confidence: 0 };
        const emaCell = byField.ema ?? { text: "", confidence: 0 };
        const ema = parseEma(emaCell.text);

        players.push({
          pseudo: pseudoCell.text,
          kills: ema.kills,
          deaths: ema.deaths,
          assists: ema.assists,
          score: parseInt0(scoreCell.text),
          is_mvp: row === 0, // 1re ligne = meilleur score = MVP (board trie)
          // confiance des STATS = celle de la cellule É/M/A (les chiffres transmis).
          // Le score (non transmis) et le pseudo (souvent stylise) n'entrent PAS ici,
          // pour ne pas faire rejeter en 422 un match aux stats parfaites.
          confidence: emaCell.confidence,
          pseudo_confidence: pseudoCell.confidence,
          rowImage: rowImageUrl(source, cellRect(table, row, { x: 0, width: 1 }, imgW, imgH)),
          cells: { pseudo: pseudoCell, score: scoreCell, ema: emaCell },
        });
      }

      teams.push({ side: table.side, players });
    }

    return { teams };
  } finally {
    await worker.terminate();
  }
}
