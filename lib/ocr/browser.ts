import { createWorker, type Worker } from "tesseract.js";
import { createCanvasSource } from "./adapters/canvas";
import { readScoreboard, type ScoreboardOptions } from "./core/scoreboard";
import type { OcrResult } from "./core/pipeline";

/**
 * POINT D'ENTREE NAVIGATEUR du moteur.
 *
 * C'est ce que consomme The Circle : l'OCR tourne sur la machine de
 * l'organisateur, pas sur un serveur. Raison mesuree : la meme capture prend
 * ~2 s dans un navigateur et depasse 60 s sur une fonction serverless du
 * palier gratuit (timeout). En prime, la capture ne quitte jamais l'appareil.
 *
 * Ce module n'importe RIEN de Next.js ni de l'application : il doit rester
 * consommable depuis n'importe quel projet.
 */

export type { OcrResult, OcrPlayer, OcrTeam, OcrCell } from "./core/pipeline";
export type { ScoreboardResult } from "./core/scoreboard";
export { cleanPseudo } from "./pseudo";

export interface BrowserOcrOptions extends ScoreboardOptions {
  /**
   * Ou trouver les fichiers de tesseract.js. A servir depuis VOTRE domaine
   * (dossier public/) plutot que depuis un CDN : pas de dependance reseau
   * externe, et ca continue de marcher si le CDN tombe ou est bloque.
   *   workerPath : tesseract worker script
   *   corePath   : dossier du coeur WASM
   *   langPath   : dossier contenant eng.traineddata.gz
   */
  workerPath?: string;
  corePath?: string;
  langPath?: string;
  /** Progression grossiere (0–1), pour une barre d'attente. */
  onProgress?: (ratio: number) => void;
}

/** Cree un worker tesseract configure pour le navigateur. A reutiliser entre
 *  plusieurs captures : l'initialisation coute ~0.3 s. */
export async function createBrowserWorker(opts: BrowserOcrOptions = {}): Promise<Worker> {
  return createWorker("eng", 1, {
    ...(opts.workerPath ? { workerPath: opts.workerPath } : {}),
    ...(opts.corePath ? { corePath: opts.corePath } : {}),
    ...(opts.langPath ? { langPath: opts.langPath } : {}),
    gzip: true,
    logger: opts.onProgress
      ? (m: { progress?: number }) => opts.onProgress?.(m.progress ?? 0)
      : undefined,
  });
}

/**
 * Lit un scoreboard depuis une image DEJA CHARGEE (HTMLImageElement decode,
 * ImageBitmap...). Cree un worker, lit, puis le libere.
 *
 * Pour enchainer plusieurs captures, preferer createBrowserWorker +
 * readScoreboardWith, afin de ne payer l'initialisation qu'une fois.
 */
export async function readScoreboardFromImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  opts: BrowserOcrOptions = {}
): Promise<{ ok: true; result: OcrResult } | { ok: false; reason: string }> {
  const worker = await createBrowserWorker(opts);
  try {
    return await readScoreboardWith(worker, source, width, height, opts);
  } finally {
    await worker.terminate();
  }
}

/** Variante a worker fourni (reutilisable). */
export async function readScoreboardWith(
  worker: Worker,
  source: CanvasImageSource,
  width: number,
  height: number,
  opts: ScoreboardOptions = {}
): Promise<{ ok: true; result: OcrResult } | { ok: false; reason: string }> {
  const src = createCanvasSource(source, width, height);
  const out = await readScoreboard(worker, src, opts);
  return out.ok ? { ok: true, result: out.result } : { ok: false, reason: out.reason };
}
