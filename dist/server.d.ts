import { type Worker } from "tesseract.js";
import { type ScoreboardOptions } from "./core/scoreboard";
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
export declare function createServerWorker(opts?: ServerOcrOptions): Promise<Worker>;
/** Lit un scoreboard depuis un buffer d'image. Cree un worker et le libere. */
export declare function readScoreboardFromBuffer(image: Buffer, opts?: ServerOcrOptions): Promise<{
    ok: true;
    result: OcrResult;
} | {
    ok: false;
    reason: string;
}>;
//# sourceMappingURL=server.d.ts.map