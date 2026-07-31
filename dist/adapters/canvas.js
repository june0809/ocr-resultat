"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCanvasSource = createCanvasSource;
const source_1 = require("../core/source");
function ctxOf(width, height) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(height));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx)
        throw new Error("canvas 2D indisponible");
    return ctx;
}
/**
 * @param source image deja chargee (HTMLImageElement decode, ImageBitmap...).
 * @param width  largeur NATIVE de l'image (naturalWidth), pas sa taille affichee.
 */
function createCanvasSource(source, width, height) {
    if (width < 2 || height < 2)
        throw new Error("dimensions image invalides");
    return {
        width,
        height,
        async rgba() {
            const ctx = ctxOf(width, height);
            ctx.drawImage(source, 0, 0);
            const img = ctx.getImageData(0, 0, width, height);
            return { data: img.data, width, height, channels: 4 };
        },
        async grey(rect) {
            const r = (0, source_1.clampRect)(rect, width, height);
            const ctx = ctxOf(r.width, r.height);
            ctx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
            const img = ctx.getImageData(0, 0, r.width, r.height);
            const d = img.data;
            // On rend un raster 4 canaux dont le canal 0 porte le gris : meme
            // convention d'indexation que sharp (les lecteurs lisent data[i*channels]).
            for (let i = 0; i < d.length; i += 4) {
                const y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
                d[i] = d[i + 1] = d[i + 2] = y;
            }
            return { data: d, width: r.width, height: r.height, channels: 4 };
        },
        async crop(rect, scale, opts = {}) {
            const r = (0, source_1.clampRect)(rect, width, height);
            const ctx = ctxOf(r.width * scale, r.height * scale);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, ctx.canvas.width, ctx.canvas.height);
            const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
            const d = img.data;
            let min = 255;
            let max = 0;
            for (let i = 0; i < d.length; i += 4) {
                let y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
                // Meme renforcement que sharp.linear(), applique avant l'etirement.
                if (opts.contrast)
                    y = Math.max(0, Math.min(255, y * source_1.CONTRAST_GAIN + source_1.CONTRAST_BIAS));
                d[i] = d[i + 1] = d[i + 2] = y;
                if (y < min)
                    min = y;
                if (y > max)
                    max = y;
            }
            // Etirement de contraste min/max — equivalent de sharp.normalize().
            const range = max - min || 1;
            for (let i = 0; i < d.length; i += 4) {
                const v = ((d[i] - min) / range) * 255;
                d[i] = d[i + 1] = d[i + 2] = v;
            }
            ctx.putImageData(img, 0, 0);
            return ctx.canvas;
        },
    };
}
//# sourceMappingURL=canvas.js.map