"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanPseudo = void 0;
exports.createBrowserWorker = createBrowserWorker;
exports.readScoreboardFromImage = readScoreboardFromImage;
exports.readScoreboardWith = readScoreboardWith;
const tesseract_js_1 = require("tesseract.js");
const canvas_1 = require("./adapters/canvas");
const scoreboard_1 = require("./core/scoreboard");
var pseudo_1 = require("./pseudo");
Object.defineProperty(exports, "cleanPseudo", { enumerable: true, get: function () { return pseudo_1.cleanPseudo; } });
/** Cree un worker tesseract configure pour le navigateur. A reutiliser entre
 *  plusieurs captures : l'initialisation coute ~0.3 s. */
async function createBrowserWorker(opts = {}) {
    return (0, tesseract_js_1.createWorker)("eng", 1, {
        ...(opts.workerPath ? { workerPath: opts.workerPath } : {}),
        ...(opts.corePath ? { corePath: opts.corePath } : {}),
        ...(opts.langPath ? { langPath: opts.langPath } : {}),
        gzip: true,
        logger: opts.onProgress
            ? (m) => opts.onProgress?.(m.progress ?? 0)
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
async function readScoreboardFromImage(source, width, height, opts = {}) {
    const worker = await createBrowserWorker(opts);
    try {
        return await readScoreboardWith(worker, source, width, height, opts);
    }
    finally {
        await worker.terminate();
    }
}
/** Variante a worker fourni (reutilisable). */
async function readScoreboardWith(worker, source, width, height, opts = {}) {
    const src = (0, canvas_1.createCanvasSource)(source, width, height);
    const out = await (0, scoreboard_1.readScoreboard)(worker, src, opts);
    return out.ok
        ? { ok: true, result: out.result, roundScore: out.roundScore }
        : { ok: false, reason: out.reason };
}
//# sourceMappingURL=browser.js.map