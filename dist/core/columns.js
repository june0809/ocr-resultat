"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectColumns = detectColumns;
const tesseract_js_1 = require("tesseract.js");
const source_1 = require("./source");
/** Lignes echantillonnees pour le reperage du pseudo (compromis cout/robustesse). */
const SAMPLE_ROWS = 2;
/** Marge ajoutee autour des bornes detectees, en fraction de la boite. */
const PAD = 0.012;
/** La passe "chiffres" ne regarde que la droite du tableau : au-dela, plus
 *  d'avatar ni de pseudo, donc aucune source de confusion. */
const NUMERIC_ZONE_START = 0.3;
/** Fenetre de recherche du pseudo, en ecart au CENTRE du score. Mesure : le
 *  pseudo commence a centre-29.9 % (iPad) / centre-28.6 % (telephone), alors
 *  que sa position ABSOLUE varie de 5 points entre les deux. */
const PSEUDO_SEARCH_FROM = 0.31;
const PSEUDO_SEARCH_TO = 0.14;
/** Repli si l'OCR ne repere aucun pseudo : fenetre plus etroite, pour ne pas
 *  avaler l'icone "ajouter en ami" qui suit le pseudo. */
const PSEUDO_FALLBACK_FROM = 0.3;
const PSEUDO_FALLBACK_TO = 0.17;
/** Demi-largeurs des colonnes de chiffres autour du centre du libelle d'en-tete.
 *  Genereuses : la whitelist chiffres filtre tout ce qui deborde. */
const EMA_HALF = 0.07;
const SCORE_HALF = 0.05;
/** Deux mots separes de moins que ca appartiennent au meme pseudo. */
const WORD_GAP = 0.03;
/** Agrandissement des extraits de reperage. */
const SCAN_SCALE = 3;
/** K/D/A : 3 nombres separes par "/". Tolere les confusions OCR du separateur. */
const KDA_RE = /^(\d{1,3})[\/|lI1](\d{1,3})[\/|lI1](\d{1,3})$/;
const NUM_RE = /^\d{1,5}$/;
/** Libelles d'interface a ne jamais confondre avec un pseudo. */
const UI_TOKENS = new Set(["MVP", "VICTOIRE", "DEFAITE", "DÉFAITE", "VICTORY", "DEFEAT"]);
/** Extrait les mots + boites, quelle que soit la forme de sortie de tesseract.js. */
function wordsOf(data) {
    const d = data;
    if (d.words?.length)
        return d.words;
    const out = [];
    for (const b of d.blocks ?? [])
        for (const p of b.paragraphs ?? [])
            for (const l of p.lines ?? [])
                for (const w of l.words ?? [])
                    out.push(w);
    return out;
}
async function recognizeWords(worker, src, rect, whitelist) {
    const img = await src.crop(rect, SCAN_SCALE);
    await worker.setParameters({
        tessedit_char_whitelist: whitelist,
        tessedit_pageseg_mode: tesseract_js_1.PSM.SPARSE_TEXT, // elements disperses sur la ligne
    });
    const { data } = await worker.recognize(img, {}, { blocks: true, text: true });
    const W = Math.max(1, Math.round(rect.width * SCAN_SCALE));
    return wordsOf(data)
        .map((w) => ({
        text: (w.text ?? "").trim(),
        x0: w.bbox.x0 / W,
        x1: w.bbox.x1 / W,
        confidence: (w.confidence ?? 0) / 100,
    }))
        .filter((w) => w.text.length > 0);
}
/** Reperage sur une portion [from,to] d'une bande de ligne. Les bornes sont
 *  ramenees en fractions de la BOITE entiere, pour raisonner dans un seul repere. */
async function scanSpan(worker, src, box, band, from, to, whitelist) {
    const b = (0, source_1.absRect)(box, src.width, src.height);
    const left = b.x + Math.round(from * b.width);
    const width = Math.max(2, Math.round((to - from) * b.width));
    // Haut de la bande : le texte y vit, l'embleme de clan est en bas.
    const top = b.y + Math.round(band.top * b.height);
    const height = Math.max(2, Math.round(band.height * b.height * 0.6));
    const words = await recognizeWords(worker, src, { x: left, y: top, width, height }, whitelist);
    return words.map((w) => ({
        ...w,
        x0: from + w.x0 * (to - from),
        x1: from + w.x1 * (to - from),
    }));
}
/** Mediane (robuste aux lignes aberrantes). */
function median(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Centres (fractions de la boite) des colonnes reperees dans l'en-tete. */
async function headerAnchors(worker, src, header) {
    const h = (0, source_1.absRect)(header, src.width, src.height);
    const words = await recognizeWords(worker, src, h, "");
    const out = {};
    for (const w of words) {
        const t = w.text.toUpperCase().replace(/[^A-Z\/]/g, "");
        if (!t)
            continue;
        const center = (w.x0 + w.x1) / 2;
        // É/M/A se lit selon les captures "E/M/A", "EMA", "É/M/A", "M/A"...
        if (out.ema === undefined && (t.includes("/M/") || t === "EMA" || t === "MA"))
            out.ema = center;
        else if (out.score === undefined && t.startsWith("SCOR"))
            out.score = center;
        else if (out.impact === undefined && t.startsWith("IMPAC"))
            out.impact = center;
    }
    return out;
}
/**
 * Repere les colonnes. Renvoie null si ni l'en-tete ni le K/D/A ne sont
 * exploitables (l'appelant retombe alors sur les fractions par defaut).
 */
async function detectColumns(worker, src, boxes, bands) {
    const box = boxes.body;
    const idx = [];
    const stepI = Math.max(1, Math.floor(bands.length / SAMPLE_ROWS));
    for (let i = 0; i < bands.length && idx.length < SAMPLE_ROWS; i += stepI)
        idx.push(i);
    // ── Ancrage 1 : les libelles de l'en-tete ────────────────────────────────
    const head = await headerAnchors(worker, src, boxes.header);
    let emaX0;
    let emaX1;
    let scoreX0;
    let scoreX1;
    let source = "en-tete";
    if (head.ema !== undefined) {
        emaX0 = head.ema - EMA_HALF;
        emaX1 = head.ema + EMA_HALF;
    }
    if (head.score !== undefined) {
        scoreX0 = head.score - SCORE_HALF;
        scoreX1 = head.score + SCORE_HALF;
    }
    // ── Ancrage 2 (repli) : la signature "N/N/N" dans les lignes ─────────────
    if (emaX0 === undefined) {
        const kda0 = [];
        const kda1 = [];
        const sco0 = [];
        const sco1 = [];
        for (const i of idx) {
            const words = await scanSpan(worker, src, box, bands[i], NUMERIC_ZONE_START, 1, "0123456789/");
            const kda = words.find((w) => KDA_RE.test(w.text));
            if (!kda)
                continue;
            kda0.push(kda.x0);
            kda1.push(kda.x1);
            const left = words
                .filter((w) => w.x1 < kda.x0 && NUM_RE.test(w.text))
                .sort((a, b) => b.x1 - a.x1);
            if (left[0]) {
                sco0.push(left[0].x0);
                sco1.push(left[0].x1);
            }
        }
        if (kda0.length === 0)
            return null; // ni en-tete ni K/D/A : inexploitable
        emaX0 = median(kda0);
        emaX1 = median(kda1);
        if (scoreX0 === undefined) {
            scoreX0 = sco0.length ? median(sco0) : emaX0 - 0.12;
            scoreX1 = sco1.length ? median(sco1) : emaX0 - 0.05;
        }
        source = "lignes (repli)";
    }
    if (emaX0 === undefined || emaX1 === undefined)
        return null;
    if (scoreX0 === undefined || scoreX1 === undefined) {
        scoreX0 = emaX0 - 0.12;
        scoreX1 = emaX0 - 0.05;
    }
    const ema0 = emaX0;
    const ema1 = emaX1;
    const sc0 = scoreX0;
    const sc1 = scoreX1;
    // ── Pseudo : fenetre calee sur le score, affinee par OCR ─────────────────
    const scoreCenter = (sc0 + sc1) / 2;
    const searchFrom = Math.max(0, scoreCenter - PSEUDO_SEARCH_FROM);
    const searchTo = Math.max(searchFrom + 0.02, scoreCenter - PSEUDO_SEARCH_TO);
    const pse0 = [];
    const pse1 = [];
    for (const i of idx) {
        const words = (await scanSpan(worker, src, box, bands[i], searchFrom, searchTo, ""))
            .filter((w) => w.confidence > 0.3 &&
            !UI_TOKENS.has(w.text.toUpperCase()) &&
            !NUM_RE.test(w.text) &&
            /[A-Za-z]/.test(w.text))
            .sort((a, b) => a.x0 - b.x0);
        if (!words.length)
            continue;
        // Le pseudo est le PREMIER groupe de mots contigus : on s'arrete au premier
        // vrai trou. Ca coupe naturellement avant l'icone "ajouter en ami" et le
        // badge MVP, separes du pseudo par un blanc franc.
        const x0 = words[0].x0;
        let x1 = words[0].x1;
        for (let k = 1; k < words.length; k++) {
            if (words[k].x0 - x1 > WORD_GAP)
                break;
            x1 = words[k].x1;
        }
        pse0.push(x0);
        pse1.push(x1);
    }
    const pseudoX0 = pse0.length ? median(pse0) : Math.max(0, scoreCenter - PSEUDO_FALLBACK_FROM);
    const pseudoX1 = pse1.length ? Math.max(...pse1) : scoreCenter - PSEUDO_FALLBACK_TO;
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const mk = (field, type, x0, x1, yHeight) => {
        const a = clamp01(x0 - PAD);
        const b = clamp01(x1 + PAD);
        return { field, type, x: a, width: Math.max(0.01, b - a), ...(yHeight ? { yHeight } : {}) };
    };
    const pct = (v) => (v * 100).toFixed(1);
    return {
        columns: [
            // yHeight 0.55 : ne lit que le haut de la ligne, pas l'embleme du bas.
            mk("pseudo", "text", pseudoX0, pseudoX1, 0.55),
            mk("score", "int", sc0, sc1),
            mk("ema", "ema", ema0, ema1),
        ],
        detail: `[${source}] pseudo ${pct(pseudoX0)}-${pct(pseudoX1)}% (${pse0.length}/${idx.length}) | ` +
            `score ${pct(sc0)}-${pct(sc1)}% | kda ${pct(ema0)}-${pct(ema1)}%`,
    };
}
//# sourceMappingURL=columns.js.map