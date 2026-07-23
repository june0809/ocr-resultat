import sharp from "sharp";
import { createWorker, PSM, type Worker } from "tesseract.js";
import os from "node:os";
import path from "node:path";
import { cellRect, type Column, type GameTemplate } from "../template";

/**
 * Pipeline OCR SERVEUR (§4.3) — port de lib/ocr/pipeline.ts, qui tournait sur
 * canvas + WASM navigateur. Ici : sharp pour le pretraitement, tesseract.js en
 * Node avec traineddata VENDOREE (paquet @tesseract.js-data/eng) -> aucun appel
 * CDN au runtime, compatible avec le FS read-only de Vercel.
 *
 * On ne fait JAMAIS d'OCR plein cadre : chaque cellule est decoupee via le
 * template puis lue au bon mode (chiffres -> whitelist ; pseudo -> texte libre).
 * Un SEUL worker est cree puis reutilise pour toutes les cellules (init ~0.3 s
 * paye une fois), et libere en fin de passe (perf + tenue du timeout Hobby).
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

export interface OcrOptions {
  /** Dossier de la traineddata vendoree. Defaut : paquet @tesseract.js-data/eng. */
  langPath?: string;
  /** Cache tesseract (doit etre ecrivable). Defaut : os.tmpdir() (= /tmp sur Vercel). */
  cachePath?: string;
}

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

const WHITELIST: Record<Column["type"], string> = {
  text: "",
  int: "0123456789",
  ema: "0123456789/",
};

/** Traineddata vendoree (modele "best_int", plus precis sur la police de jeu).
 *  Override via TESSDATA_PATH si la resolution par defaut ne tombe pas juste dans
 *  le bundle serverless Vercel (garde-fou : evite un redeploy si le chemin change). */
function defaultLangPath(): string {
  return (
    process.env.TESSDATA_PATH ??
    path.resolve(
      process.cwd(),
      "node_modules/@tesseract.js-data/eng/4.0.0_best_int"
    )
  );
}

/**
 * Decoupe une cellule, l'agrandit xN, gris + normalisation min/max (etirement de
 * contraste). Meme recette que le banc navigateur, portee sur sharp. Renvoie un
 * PNG pret pour tesseract. Les bornes sont clampees a l'image.
 */
async function preprocessCell(
  image: Buffer,
  rect: { x: number; y: number; width: number; height: number },
  imgW: number,
  imgH: number,
  scale = 3
): Promise<Buffer> {
  const left = Math.min(Math.max(0, Math.round(rect.x)), imgW - 1);
  const top = Math.min(Math.max(0, Math.round(rect.y)), imgH - 1);
  const width = Math.max(1, Math.min(Math.round(rect.width), imgW - left));
  const height = Math.max(1, Math.min(Math.round(rect.height), imgH - top));
  return sharp(image)
    .extract({ left, top, width, height })
    .resize({ width: Math.max(1, Math.round(width * scale)) })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
}

async function recognizeCell(
  worker: Worker,
  buffer: Buffer,
  type: Column["type"]
): Promise<OcrCell> {
  await worker.setParameters({
    tessedit_char_whitelist: WHITELIST[type],
    tessedit_pageseg_mode: PSM.SINGLE_LINE, // ligne unique (§4.3)
  });
  const { data } = await worker.recognize(buffer);
  return {
    text: data.text.trim().replace(/\s+/g, type === "text" ? " " : ""),
    confidence: Math.max(0, Math.min(1, data.confidence / 100)),
  };
}

/**
 * Lance l'OCR sur toute la grille. `template` porte les boites (auto-detectees
 * par detect.ts) et le decoupage des lignes/colonnes. `image` = buffer d'origine ;
 * `imgW/imgH` = ses dimensions natives.
 */
export async function runOcr(
  image: Buffer,
  imgW: number,
  imgH: number,
  template: GameTemplate,
  opts: OcrOptions = {}
): Promise<OcrResult> {
  const worker = await createWorker("eng", 1, {
    langPath: opts.langPath ?? defaultLangPath(),
    cachePath: opts.cachePath ?? os.tmpdir(),
    gzip: true,
  });
  try {
    const teams: OcrTeam[] = [];

    for (const table of template.tables) {
      const players: OcrPlayer[] = [];

      const rowCount = table.rows.bands?.length ?? table.rows.count;
      for (let row = 0; row < rowCount; row++) {
        const byField: Record<string, OcrCell> = {};

        for (const col of table.columns) {
          const rect = cellRect(table, row, col, imgW, imgH);
          byField[col.field] = await recognizeCell(
            worker,
            await preprocessCell(image, rect, imgW, imgH),
            col.type
          );
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
          is_mvp: row === 0, // board trie par score -> 1re ligne = MVP
          // confiance des STATS = cellule K/D/A (chiffres transmis). Le score et le
          // pseudo n'entrent pas ici, pour ne pas faire rejeter en 422 un match aux
          // stats parfaites mais pseudo stylise.
          confidence: emaCell.confidence,
          pseudo_confidence: pseudoCell.confidence,
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
