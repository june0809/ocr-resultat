"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readScoreboard = readScoreboard;
const detect_1 = require("./detect");
const anchor_1 = require("./anchor");
const pipeline_1 = require("./pipeline");
const roundscore_1 = require("./roundscore");
const template_1 = require("../template");
async function readScoreboard(worker, src, opts = {}) {
    const boxes = await (0, detect_1.autoDetectTables)(src);
    if (!boxes)
        return { ok: false, reason: "tableaux (barres bleu/rouge) non detectes" };
    // Ancrage des lignes independamment pour chaque equipe : les deux tableaux
    // n'ont pas forcement le meme nombre de joueurs (deconnexion, forfait).
    const blueBands = await (0, anchor_1.anchorRows)(src, boxes.blue.body);
    const redBands = await (0, anchor_1.anchorRows)(src, boxes.red.body);
    if (!blueBands || !redBands)
        return { ok: false, reason: "lignes de joueurs non ancrees" };
    const template = {
        game: opts.game ?? "codm",
        mode: opts.mode ?? "team_deathmatch",
        tables: (0, template_1.codmSndTablesAnchored)({ box: boxes.blue.body, header: boxes.blue.header, bands: blueBands }, { box: boxes.red.body, header: boxes.red.header, bands: redBands }),
    };
    const result = await (0, pipeline_1.runOcr)(worker, src, template, { onDebug: opts.onDebug });
    // Score de manches ("2:5") = vainqueur déterministe, lu dans la bande au-dessus
    // des barres d'en-tête. Best-effort : s'il est illisible, l'UI redemandera.
    let roundScore = null;
    try {
        roundScore = await (0, roundscore_1.readRoundScore)(worker, src, boxes.blue.header.y);
    }
    catch {
        roundScore = null;
    }
    opts.onDebug?.(`[round] ${roundScore ? `${roundScore.blue}:${roundScore.red}` : "non lu"}`);
    return { ok: true, result, template, roundScore };
}
//# sourceMappingURL=scoreboard.js.map