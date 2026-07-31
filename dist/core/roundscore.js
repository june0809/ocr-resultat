"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readRoundScore = readRoundScore;
const tesseract_js_1 = require("tesseract.js");
const source_1 = require("./source");
// Deux nombres séparés d'un ':', NON précédés/suivis d'un chiffre ou d'un ':'
// (ce qui écarte "21:56:18" et autres horaires).
const SCORE_RE = /(?<![\d:])(\d{1,2})\s*[:;]\s*(\d{1,2})(?![\d:])/g;
/** Le score vit en HAUT À GAUCHE ; au-delà, ce sont les statistiques de fin de
 *  partie (EXP, précision…), qui n'apporteraient que du bruit. */
const LEFT_FRACTION = 0.45;
const SCALE = 4;
/**
 * Cascade de lectures, la moins agressive d'abord — technique éprouvée sur les
 * polices de jeu. Aucun réglage unique ne marche partout :
 *   - sans renforcement, PSM épars : suffit quand le score est bien contrasté ;
 *   - AVEC renforcement : indispensable quand il est gris et collé au mot
 *     ("VICTOIRE5:4"), illisible autrement ;
 *   - PSM bloc : rattrape les mises en page où l'épars sépare les deux chiffres.
 */
const PASSES = [
    { contrast: false, psm: tesseract_js_1.PSM.SPARSE_TEXT },
    { contrast: true, psm: tesseract_js_1.PSM.SPARSE_TEXT },
    { contrast: false, psm: tesseract_js_1.PSM.SINGLE_BLOCK },
    { contrast: true, psm: tesseract_js_1.PSM.SINGLE_BLOCK },
];
function parse(text) {
    const scored = [...text.replace(/\n/g, ' ').matchAll(SCORE_RE)]
        .map((m) => ({ blue: parseInt(m[1], 10), red: parseInt(m[2], 10) }))
        // Un score de manches CODM plafonne bas ; au-delà c'est un nombre parasite.
        .filter((s) => s.blue <= 12 && s.red <= 12 && s.blue + s.red > 0)
        .sort((a, b) => a.blue + a.red - (b.blue + b.red));
    return scored[0] ?? null;
}
async function readRoundScore(worker, src, 
/** Y (fraction de l'image) du haut de la barre d'en-tête : la bande à lire va
 *  du haut de l'image jusque-là. */
headerTopY) {
    const bottom = Math.max(0.02, Math.min(0.9, headerTopY));
    const rect = (0, source_1.absRect)({ x: 0, y: 0, width: LEFT_FRACTION, height: bottom }, src.width, src.height);
    for (const pass of PASSES) {
        const img = await src.crop(rect, SCALE, { contrast: pass.contrast });
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789:',
            tessedit_pageseg_mode: pass.psm,
        });
        const { data } = await worker.recognize(img, {}, { blocks: true, text: true });
        const found = parse(data.text ?? '');
        if (found)
            return found;
    }
    return null;
}
//# sourceMappingURL=roundscore.js.map