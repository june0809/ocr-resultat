import type { Worker } from "tesseract.js";
import type { ImageSource } from "./source";
import { autoDetectTables } from "./detect";
import { anchorRows } from "./anchor";
import { runOcr, type OcrResult } from "./pipeline";
import { codmSndTablesAnchored, type GameTemplate, type Mode } from "../template";

/**
 * Chaine complete de lecture d'un scoreboard, PARTAGEE Node/navigateur :
 *   detect (barres bleu/rouge) -> anchor (lignes par projection) -> template
 *   ancre -> detection des colonnes -> OCR par cellule.
 *
 * Aucune capture n'est conservee : on lit les pixels, on rend le resultat.
 */

export type ScoreboardResult =
  | { ok: true; result: OcrResult; template: GameTemplate }
  | { ok: false; reason: string };

export interface ScoreboardOptions {
  game?: string;
  mode?: Mode;
  onDebug?: (message: string) => void;
}

export async function readScoreboard(
  worker: Worker,
  src: ImageSource,
  opts: ScoreboardOptions = {}
): Promise<ScoreboardResult> {
  const boxes = await autoDetectTables(src);
  if (!boxes) return { ok: false, reason: "tableaux (barres bleu/rouge) non detectes" };

  // Ancrage des lignes independamment pour chaque equipe : les deux tableaux
  // n'ont pas forcement le meme nombre de joueurs (deconnexion, forfait).
  const blueBands = await anchorRows(src, boxes.blue.body);
  const redBands = await anchorRows(src, boxes.red.body);
  if (!blueBands || !redBands) return { ok: false, reason: "lignes de joueurs non ancrees" };

  const template: GameTemplate = {
    game: opts.game ?? "codm",
    mode: opts.mode ?? "team_deathmatch",
    tables: codmSndTablesAnchored(
      { box: boxes.blue.body, header: boxes.blue.header, bands: blueBands },
      { box: boxes.red.body, header: boxes.red.header, bands: redBands }
    ),
  };

  const result = await runOcr(worker, src, template, { onDebug: opts.onDebug });
  return { ok: true, result, template };
}
