import os from "node:os";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import { createSharpSource } from "./adapters/sharp";
import { readScoreboard, type ScoreboardOptions } from "./core/scoreboard";
import type { OcrResult } from "./core/pipeline";

/**
 * POINT D'ENTREE NODE du moteur (memes algorithmes que browser.ts, autre source
 * de pixels).
 *
 * Sert au banc headless et au chemin image de l'API. ATTENTION : mesure faite
 * le 23/07, l'OCR serveur depasse les 60 s sur le palier gratuit Vercel (la
 * meme capture prend 2 s dans un navigateur). Ce chemin n'est donc exploitable
 * que sur un hebergeur offrant du vrai CPU. Pour l'usage interactif, c'est
 * browser.ts qu'il faut utiliser.
 */

export type { OcrResult, OcrPlayer, OcrTeam, OcrCell } from "./core/pipeline";
export { cleanPseudo } from "./pseudo";

export interface ServerOcrOptions extends ScoreboardOptions {
  /** Dossier de la traineddata vendoree. Defaut : paquet @tesseract.js-data/eng. */
  langPath?: string;
  /** Cache tesseract (doit etre ecrivable). Defaut : os.tmpdir() (= /tmp sur Vercel). */
  cachePath?: string;
}

/** Traineddata vendoree (modele "best_int", plus precis sur la police de jeu).
 *  Override via TESSDATA_PATH si la resolution par defaut ne tombe pas juste
 *  dans le bundle serverless. */
function defaultLangPath(): string {
  return (
    process.env.TESSDATA_PATH ??
    path.resolve(process.cwd(), "node_modules/@tesseract.js-data/eng/4.0.0_best_int")
  );
}

export async function createServerWorker(opts: ServerOcrOptions = {}): Promise<Worker> {
  return createWorker("eng", 1, {
    langPath: opts.langPath ?? defaultLangPath(),
    cachePath: opts.cachePath ?? os.tmpdir(),
    gzip: true,
  });
}

/** Lit un scoreboard depuis un buffer d'image. Cree un worker et le libere. */
export async function readScoreboardFromBuffer(
  image: Buffer,
  opts: ServerOcrOptions = {}
): Promise<{ ok: true; result: OcrResult } | { ok: false; reason: string }> {
  let src;
  try {
    src = await createSharpSource(image);
  } catch {
    return { ok: false, reason: "image non decodable" };
  }
  const worker = await createServerWorker(opts);
  try {
    const out = await readScoreboard(worker, src, opts);
    return out.ok ? { ok: true, result: out.result } : { ok: false, reason: out.reason };
  } finally {
    await worker.terminate();
  }
}
