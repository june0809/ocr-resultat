"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanPseudo = void 0;
exports.createServerWorker = createServerWorker;
exports.readScoreboardFromBuffer = readScoreboardFromBuffer;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const tesseract_js_1 = require("tesseract.js");
const sharp_1 = require("./adapters/sharp");
const scoreboard_1 = require("./core/scoreboard");
var pseudo_1 = require("./pseudo");
Object.defineProperty(exports, "cleanPseudo", { enumerable: true, get: function () { return pseudo_1.cleanPseudo; } });
/** Traineddata vendoree (modele "best_int", plus precis sur la police de jeu).
 *  Override via TESSDATA_PATH si la resolution par defaut ne tombe pas juste
 *  dans le bundle serverless. */
function defaultLangPath() {
    return (process.env.TESSDATA_PATH ??
        node_path_1.default.resolve(process.cwd(), "node_modules/@tesseract.js-data/eng/4.0.0_best_int"));
}
async function createServerWorker(opts = {}) {
    return (0, tesseract_js_1.createWorker)("eng", 1, {
        langPath: opts.langPath ?? defaultLangPath(),
        cachePath: opts.cachePath ?? node_os_1.default.tmpdir(),
        gzip: true,
    });
}
/** Lit un scoreboard depuis un buffer d'image. Cree un worker et le libere. */
async function readScoreboardFromBuffer(image, opts = {}) {
    let src;
    try {
        src = await (0, sharp_1.createSharpSource)(image);
    }
    catch {
        return { ok: false, reason: "image non decodable" };
    }
    const worker = await createServerWorker(opts);
    try {
        const out = await (0, scoreboard_1.readScoreboard)(worker, src, opts);
        return out.ok ? { ok: true, result: out.result } : { ok: false, reason: out.reason };
    }
    finally {
        await worker.terminate();
    }
}
//# sourceMappingURL=server.js.map