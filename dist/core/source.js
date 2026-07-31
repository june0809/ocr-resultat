"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTRAST_BIAS = exports.CONTRAST_GAIN = void 0;
exports.clampRect = clampRect;
exports.absRect = absRect;
/** Coefficients du renforcement de contraste, partages par les deux adaptateurs
 *  pour que le banc headless dise la verite sur ce que verra l'utilisateur. */
exports.CONTRAST_GAIN = 2.0;
exports.CONTRAST_BIAS = -60;
/** Borne un rectangle a l'interieur de l'image (evite les extractions hors cadre). */
function clampRect(rect, imgW, imgH) {
    const x = Math.min(Math.max(0, Math.round(rect.x)), Math.max(0, imgW - 1));
    const y = Math.min(Math.max(0, Math.round(rect.y)), Math.max(0, imgH - 1));
    return {
        x,
        y,
        width: Math.max(1, Math.min(Math.round(rect.width), imgW - x)),
        height: Math.max(1, Math.min(Math.round(rect.height), imgH - y)),
    };
}
/** Rectangle absolu (px) d'une zone relative. */
function absRect(box, imgW, imgH) {
    return clampRect({ x: box.x * imgW, y: box.y * imgH, width: box.width * imgW, height: box.height * imgH }, imgW, imgH);
}
//# sourceMappingURL=source.js.map