import type { Worker } from "tesseract.js";
import type { ImageSource } from "./source";
import { type OcrResult } from "./pipeline";
import { type RoundScore } from "./roundscore";
import { type GameTemplate, type Mode } from "../template";
/**
 * Chaine complete de lecture d'un scoreboard, PARTAGEE Node/navigateur :
 *   detect (barres bleu/rouge) -> anchor (lignes par projection) -> template
 *   ancre -> detection des colonnes -> OCR par cellule.
 *
 * Aucune capture n'est conservee : on lit les pixels, on rend le resultat.
 */
export type { RoundScore } from "./roundscore";
export type ScoreboardResult = {
    ok: true;
    result: OcrResult;
    template: GameTemplate;
    roundScore: RoundScore | null;
} | {
    ok: false;
    reason: string;
};
export interface ScoreboardOptions {
    game?: string;
    mode?: Mode;
    onDebug?: (message: string) => void;
}
export declare function readScoreboard(worker: Worker, src: ImageSource, opts?: ScoreboardOptions): Promise<ScoreboardResult>;
//# sourceMappingURL=scoreboard.d.ts.map