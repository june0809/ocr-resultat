"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSharpSource = createSharpSource;
const sharp_1 = __importDefault(require("sharp"));
const source_1 = require("../core/source");
/**
 * Adaptateur SERVEUR (Node) — pixels via sharp.
 * Ne contient AUCUN algorithme : uniquement la traduction "donne-moi ces
 * pixels". Voir core/source.ts pour le pourquoi.
 */
async function createSharpSource(image) {
    const meta = await (0, sharp_1.default)(image).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 2 || height < 2)
        throw new Error("dimensions image invalides");
    return {
        width,
        height,
        async rgba() {
            // ensureAlpha() force 4 canaux : l'indexation des pixels est alors la
            // meme que celle d'un canvas navigateur (stride de 4).
            const { data, info } = await (0, sharp_1.default)(image)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            return { data, width: info.width, height: info.height, channels: info.channels };
        },
        async grey(rect) {
            const r = (0, source_1.clampRect)(rect, width, height);
            const { data, info } = await (0, sharp_1.default)(image)
                .extract({ left: r.x, top: r.y, width: r.width, height: r.height })
                .greyscale()
                .raw()
                .toBuffer({ resolveWithObject: true });
            return { data, width: info.width, height: info.height, channels: info.channels };
        },
        async crop(rect, scale, opts = {}) {
            const r = (0, source_1.clampRect)(rect, width, height);
            let p = (0, sharp_1.default)(image)
                .extract({ left: r.x, top: r.y, width: r.width, height: r.height })
                .resize({ width: Math.max(1, Math.round(r.width * scale)) })
                .grayscale();
            if (opts.contrast)
                p = p.linear(source_1.CONTRAST_GAIN, source_1.CONTRAST_BIAS);
            return p.normalize().png().toBuffer();
        },
    };
}
//# sourceMappingURL=sharp.js.map