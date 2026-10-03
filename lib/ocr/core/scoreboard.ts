import type { Worker } from "tesseract.js";
import type { ImageSource } from "./source";
import { autoDetectTables } from "./detect";
import { anchorRows } from "./anchor";
import { runOcr, type OcrResult } from "./pipeline";
import { readRoundScore, type RoundScore } from "./roundscore";
import { codmSndTablesAnchored, type GameTemplate, type Mode } from "../template";

/**
 * Chaine complete de lecture d'un scoreboard, PARTAGEE Node/navigateur :
 *   detect (barres bleu/rouge) -> anchor (lignes par projection) -> template
 *   ancre -> detection des colonnes -> OCR par cellule.
 *
 * Aucune capture n'est conservee : on lit les pixels, on rend le resultat.
 */

export type { RoundScore } from "./roundscore";

export type ScoreboardResult =
  | { ok: true; result: OcrResult; template: GameTemplate; roundScore: RoundScore | null }
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

  // Score de manches ("2:5") = vainqueur déterministe, lu dans la bande au-dessus
  // des barres d'en-tête. Best-effort : s'il est illisible, l'UI redemandera.
  // Lu AVANT les cellules : en Recherche & Destruction, il borne aussi les morts
  // de chaque joueur (une mort par manche au plus), ce qui sert au contrôle de
  // cohérence des É/M/A.
  let roundScore: RoundScore | null = null;
  try {
    roundScore = await readRoundScore(worker, src, boxes.blue.header.y);
  } catch {
    roundScore = null;
  }
  opts.onDebug?.(`[round] ${roundScore ? `${roundScore.blue}:${roundScore.red}` : "non lu"}`);
  const rounds = roundScore ? roundScore.blue + roundScore.red : 0;
  const maxDeaths =
    roundScore && Math.max(roundScore.blue, roundScore.red) >= 3 && rounds <= 25 ? rounds : undefined;

  const result = await runOcr(worker, src, template, { onDebug: opts.onDebug, maxDeaths });

  return { ok: true, result, template, roundScore };
}
