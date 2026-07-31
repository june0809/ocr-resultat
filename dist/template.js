"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODM_SND = exports.SND_COLUMNS = void 0;
exports.codmSndTables = codmSndTables;
exports.codmSndTablesAnchored = codmSndTablesAnchored;
exports.cellRect = cellRect;
/**
 * Colonnes communes aux deux tableaux (memes proportions internes), RELATIVES a
 * la boite du tableau (= etendue de la barre d'en-tete detectee).
 *
 * CALIBRE AU PIXEL sur les vraies captures (scripts/calib-dump.ts pose une regle
 * en % sur la boite detectee). Reperes mesures, en % de la largeur de boite :
 *
 *   0–9    medaillon de rang (1/2/3, ou chiffre nu)
 *   10–20.5 avatar (portrait du joueur)
 *   22–27  embleme de clan / rang  <- dans le BAS de la ligne (exclu par yHeight)
 *   23.6–37 PSEUDO
 *   37.5–42 bouton ami / inviter   <- a exclure imperativement
 *   43.5–50 badge MVP (1re ligne seulement)
 *   50–57  SCORE
 *   58–62  bouton "..."            <- a exclure
 *   65–73.5 K/D/A
 *   84–89  impact (non utilise)
 *
 * La calibration precedente (pseudo 16–36 %) DEMARRAIT DANS L'AVATAR : le bord
 * du portrait produisait le bruit de tete recurrent ("nN ", "By | ", "= ", "> ")
 * et le pseudo etait tronque a droite ("AZ-Alk_pc(Pau"). Le score (40–51 %) ne
 * couvrait meme pas le nombre : il lisait le bouton ami et le badge MVP.
 */
exports.SND_COLUMNS = [
    // 22.5–37 % : demarre APRES l'avatar, s'arrete AVANT le bouton ami.
    // yHeight 0.55 : ne lit que le haut de la ligne (le texte), pas l'embleme de
    // clan du bas -> supprime les caracteres parasites (@400, ®, ...).
    { field: "pseudo", type: "text", x: 0.225, width: 0.145, yHeight: 0.55 },
    // 49.5–58 % : centre sur le nombre. Non transmis a The Circle : sert a
    // l'affichage et a la verif de coherence (scores decroissants).
    { field: "score", type: "int", x: 0.495, width: 0.085 },
    // 63–75 % : resserre autour du K/D/A, exclut le bouton "..." (58–62 %).
    { field: "ema", type: "ema", x: 0.63, width: 0.12 },
    // impact (>0.8) ignore : non utilise cote The Circle.
];
/** Construit les 2 tableaux CODM S&D a partir des boites (auto-detectees ou
 *  ajustees a la main) et du nombre de joueurs par equipe. */
function codmSndTables(blueBox, redBox, count) {
    const rows = { top: 0, height: 1 / count, count };
    return [
        { side: "blue", box: blueBox, rows, columns: exports.SND_COLUMNS },
        { side: "red", box: redBox, rows, columns: exports.SND_COLUMNS },
    ];
}
/**
 * Variante ANCREE (chemin image serveur) : chaque tableau porte ses PROPRES
 * bandes (ancrage par projection), donc son propre nombre de lignes — deduit de
 * la capture, pas choisi a la main. Remplace le decoupage egal + la grille v1.
 */
function codmSndTablesAnchored(blue, red) {
    const mk = (side, box, header, bands) => ({
        side,
        box,
        ...(header ? { header } : {}),
        rows: {
            top: 0,
            height: bands.length ? 1 / bands.length : 1,
            count: bands.length,
            bands,
        },
        columns: exports.SND_COLUMNS,
    });
    return [
        mk("blue", blue.box, blue.header, blue.bands),
        mk("red", red.box, red.header, red.bands),
    ];
}
/** Template par defaut (boites approximatives ; en pratique l'auto-detection
 *  remplace les boites au chargement de l'image). count par defaut = 4. */
exports.CODM_SND = {
    game: "codm",
    mode: "team_deathmatch",
    tables: codmSndTables({ x: 0.01, y: 0.3, width: 0.49, height: 0.45 }, { x: 0.5, y: 0.3, width: 0.49, height: 0.45 }, 4),
};
/** Rectangle absolu (px) d'une cellule dans l'image, a partir du template + dims. */
function cellRect(table, rowIndex, col, imgW, imgH) {
    const boxX = table.box.x * imgW;
    const boxY = table.box.y * imgH;
    const boxW = table.box.width * imgW;
    const boxH = table.box.height * imgH;
    // Ancrage par projection (bande calee sur le texte) s'il existe, sinon
    // decoupage egal (modele par defaut / chemin navigateur).
    const band = table.rows.bands?.[rowIndex];
    const relTop = band ? band.top : table.rows.top + rowIndex * table.rows.height;
    const relH = band ? band.height : table.rows.height;
    const rowTop = boxY + relTop * boxH;
    const rowH = relH * boxH;
    const yHeight = col.yHeight ?? 1;
    return {
        x: boxX + col.x * boxW,
        y: rowTop,
        width: col.width * boxW,
        height: rowH * yHeight,
    };
}
//# sourceMappingURL=template.js.map