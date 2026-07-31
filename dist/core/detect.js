"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoDetectTables = autoDetectTables;
const isBlue = (r, g, b) => b > 110 && b - r > 25 && b - g > 5 && r < 140;
const isRed = (r, g, b) => r > 110 && r - b > 30 && r - g > 30 && b < 130;
/**
 * Renvoie les deux tableaux, ou null si l'en-tete bleu/rouge est introuvable
 * (capture non reconnue -> l'appelant remonte une erreur exploitable).
 */
async function autoDetectTables(src) {
    const { data, width: imgW, height: imgH, channels } = await src.rgba();
    const at = (x, y) => {
        const i = (y * imgW + x) * channels;
        return [data[i], data[i + 1], data[i + 2]];
    };
    // 1) bande d'en-tete : moitie gauche tres bleue ET moitie droite tres rouge
    let hTop = -1;
    let hBot = -1;
    const half = Math.floor(imgW / 2);
    for (let y = 0; y < imgH; y++) {
        let bl = 0;
        let rd = 0;
        for (let x = 0; x < half; x++)
            if (isBlue(...at(x, y)))
                bl++;
        for (let x = half; x < imgW; x++)
            if (isRed(...at(x, y)))
                rd++;
        if (bl / half > 0.5 && rd / half > 0.4) {
            if (hTop < 0)
                hTop = y;
            hBot = y;
        }
    }
    if (hTop < 0)
        return null;
    // 2) etendue X des barres bleue et rouge (ligne mediane de l'en-tete)
    const my = Math.floor((hTop + hBot) / 2);
    let bxMin = imgW;
    let bxMax = 0;
    let rxMin = imgW;
    let rxMax = 0;
    for (let x = 0; x < imgW; x++) {
        const [r, g, b] = at(x, my);
        if (isBlue(r, g, b)) {
            bxMin = Math.min(bxMin, x);
            bxMax = Math.max(bxMax, x);
        }
        if (isRed(r, g, b)) {
            rxMin = Math.min(rxMin, x);
            rxMax = Math.max(rxMax, x);
        }
    }
    if (bxMax <= bxMin || rxMax <= rxMin)
        return null;
    // 3) bas du tableau : derniere bande avec du contenu clair avant le trou du footer
    const bright = (x, y) => {
        const [r, g, b] = at(x, y);
        return (r + g + b) / 3 > 95;
    };
    const bandH = Math.max(2, Math.round(imgH * 0.01));
    let bottom = hBot;
    let gap = 0;
    for (let y = hBot + bandH; y < imgH * 0.9; y += bandH) {
        let cnt = 0;
        for (let x = bxMin; x < bxMax; x++)
            if (bright(x, y))
                cnt++;
        if (cnt / Math.max(1, bxMax - bxMin) > 0.03) {
            bottom = y;
            gap = 0;
        }
        else {
            gap += bandH;
            if (gap > imgH * 0.05)
                break; // trou franc = fin du tableau
        }
    }
    const top = hBot;
    const mk = (xMin, xMax) => ({
        body: {
            x: xMin / imgW,
            y: top / imgH,
            width: (xMax - xMin) / imgW,
            height: (bottom - top) / imgH,
        },
        header: {
            x: xMin / imgW,
            y: hTop / imgH,
            width: (xMax - xMin) / imgW,
            height: Math.max(1, hBot - hTop) / imgH,
        },
    });
    return { blue: mk(bxMin, bxMax), red: mk(rxMin, rxMax) };
}
//# sourceMappingURL=detect.js.map