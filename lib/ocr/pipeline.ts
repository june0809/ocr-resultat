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

/** Decoupe une cellule dans un canvas offscreen, agrandie x3 pour aider l'OCR. */
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
  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    c.width,
    c.height
  );
  return c;
}

const WHITELIST: Record<Column["type"], string> = {
  text: "",
  int: "0123456789",
  ema: "0123456789/",
};

// Detection du badge MVP par couleur. dore = MVP gagnant, argente = MVP perdant.
const isGold = (r: number, g: number, b: number) =>
  r > 150 && g > 115 && b < 110 && r - b > 55 && g - b > 35;
const isSilver = (r: number, g: number, b: number) =>
  r > 120 && g > 130 && b > 140 && Math.max(r, g, b) - Math.min(r, g, b) < 45 && b >= r;

/** Fraction de pixels "badge" (dore+argente) dans un rectangle. */
function badgeScore(
  source: CanvasImageSource,
  rect: { x: number; y: number; width: number; height: number }
): number {
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let hit = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (isGold(data[i], data[i + 1], data[i + 2]) || isSilver(data[i], data[i + 1], data[i + 2])) hit++;
  }
  return hit / (w * h);
}

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
      const badgeScores: number[] = [];

      for (let row = 0; row < table.rows.count; row++) {
        const byField: Record<string, OcrCell> = {};

        for (const col of table.columns) {
          const rect = cellRect(table, row, col, imgW, imgH);
          const cell = await recognizeCell(worker, cropCell(source, rect), col.type);
          byField[col.field] = cell;
          onProgress?.(++done, total);
        }

        // signal du badge MVP pour cette ligne (0 si pas de zone definie)
        badgeScores.push(
          table.mvpBadge
            ? badgeScore(source, cellRect(table, row, table.mvpBadge, imgW, imgH))
            : 0
        );

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
          is_mvp: false, // pose apres, sur la ligne au badge maximal
          // confiance des STATS = celle de la cellule É/M/A (les chiffres transmis).
          // Le score (non transmis) et le pseudo (souvent stylise) n'entrent PAS ici,
          // pour ne pas faire rejeter en 422 un match aux stats parfaites.
          confidence: emaCell.confidence,
          pseudo_confidence: pseudoCell.confidence,
          cells: { pseudo: pseudoCell, score: scoreCell, ema: emaCell },
        });
      }

      // MVP = ligne au signal badge (dore+argente) maximal, si un badge est present.
      if (table.mvpBadge) {
        let best = 0;
        for (let i = 1; i < badgeScores.length; i++) if (badgeScores[i] > badgeScores[best]) best = i;
        // seuil minimal pour eviter un faux positif si aucun badge lisible
        if (badgeScores[best] > 0.04) players[best].is_mvp = true;
      }

      teams.push({ side: table.side, players });
    }

    return { teams };
  } finally {
    await worker.terminate();
  }
}
