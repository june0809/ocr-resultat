import { PSM, type Worker } from "tesseract.js";
import { absRect, type CropOptions, type ImageSource, type Rect } from "./source";
import { detectColumns } from "./columns";
import { cellRect, type Column, type GameTemplate, type TableTemplate } from "../template";
import { cleanPseudo } from "../pseudo";
import {
  balanced,
  deduceRow,
  gaps,
  isValid,
  LOOSE_LIMITS,
  rowOptions,
  searchCombination,
  type EmaCheck,
  type Kda,
  type Limits,
  type RowOptions,
} from "./coherence";

/**
 * Lecture du scoreboard, cellule par cellule.
 *
 * On ne fait JAMAIS d'OCR plein cadre : les polices stylisees sur fond
 * translucide donnent de la bouillie. Chaque cellule est decoupee via le
 * template puis lue au bon mode (chiffres -> whitelist, pseudo -> texte libre).
 *
 * Partage Node/navigateur : les pixels passent par ImageSource, le moteur par
 * un Worker tesseract fourni par l'appelant (qui sait, lui, ou trouver la
 * traineddata sur sa plateforme).
 */

export interface OcrCell {
  text: string;
  /** 0.0–1.0 (tesseract rend 0–100, converti ici). */
  confidence: number;
}

export interface OcrPlayer {
  pseudo: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: number | null;
  /** MVP = 1re ligne (board trie par score decroissant). Corrigible cote UI. */
  is_mvp: boolean;
  /** confiance des STATS (cellule K/D/A) : alimente la confiance globale + 422. */
  confidence: number;
  /** confiance de lecture du pseudo : warning + surlignage, jamais le 422. */
  pseudo_confidence: number;
  /** Autres lectures du MEME pseudo, sous un autre pretraitement. Un pseudo
   *  stylise ressort rarement deux fois pareil : le rapprochement cote
   *  appelant compare toutes les lectures, pas seulement la premiere. */
  pseudo_alternatives?: string[];
  /** Verdict du controle de coherence kills/morts (cf. core/coherence.ts) :
   *  ok, corrige (une relecture retablit l'egalite), deduit (calcule a partir
   *  des autres lignes), douteux (rien ne tient : a verifier a l'oeil). */
  ema_check?: EmaCheck;
  /** Lecture d'origine quand la ligne a ete corrigee ou deduite. */
  ema_original?: string;
  cells: { pseudo: OcrCell; score: OcrCell; ema: OcrCell };
}

export interface OcrTeam {
  side: "blue" | "red";
  players: OcrPlayer[];
}

export interface OcrCoherence {
  /** false : controle impossible (equipes de tailles differentes, un joueur
   *  parti en cours de partie n'apparait plus). */
  checked: boolean;
  /** L'egalite tient-elle apres correction ? null si une valeur manque. */
  balanced: boolean | null;
  /** kills bleus - morts rouges, kills rouges - morts bleues. */
  gaps: { blue: number; red: number } | null;
  /** Lignes modifiees par le controle. */
  corrected: number;
}

export interface OcrResult {
  teams: OcrTeam[];
  coherence?: OcrCoherence;
}

/** Agrandissement des extraits de cellule avant lecture. */
const CELL_SCALE = 3;

/** Pretraitement principal par type de cellule. Le negatif (encre noire sur
 *  fond blanc) aide les pseudos et les E/M/A ; il n'apporte rien au score. */
const CELL_CROP: Record<Column["type"], CropOptions> = {
  text: { invert: true },
  int: {},
  ema: { invert: true },
};

/** Relecture du pseudo sous un autre pretraitement (l'ancienne passe
 *  principale, sans negatif) : une deuxieme chance pour le rapprochement. */
const PSEUDO_ALT: CropOptions = {};

/** Relectures des E/M/A quand l'egalite kills/morts ne tient pas. Mesure le
 *  03/10 : chaque variante rattrape des 7 que les autres lisent 1. */
const EMA_ALT: Array<{ scale: number; opts: CropOptions }> = [
  { scale: 3, opts: {} },
  { scale: 2, opts: { invert: true } },
  { scale: 4, opts: { invert: true } },
];

const WHITELIST: Record<Column["type"], string> = {
  text: "",
  int: "0123456789",
  ema: "0123456789/",
};

/** "15/7/0" (avec bruit OCR) -> {kills,deaths,assists} : 3 premiers nombres. */
export function parseEma(raw: string): {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
} {
  const nums = (raw.match(/\d+/g) ?? []).map((n) => parseInt(n, 10));
  return { kills: nums[0] ?? null, deaths: nums[1] ?? null, assists: nums[2] ?? null };
}

/** Extrait un entier d'une chaine OCR bruitee ("SCORE 240" -> 240). */
export function parseInt0(raw: string): number | null {
  const m = raw.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Regle le moteur pour un TYPE de colonne. A appeler le moins souvent
 *  possible : un changement de parametres force tesseract a se reinitialiser,
 *  ce qui coute bien plus cher que la reconnaissance elle-meme sur un CPU
 *  contraint. D'ou la boucle "colonne d'abord" de runOcr. */
async function setCellParams(worker: Worker, type: Column["type"]): Promise<void> {
  await worker.setParameters({
    tessedit_char_whitelist: WHITELIST[type],
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
  });
}

export interface RunOcrOptions {
  /** Trace les colonnes detectees (diagnostic). */
  onDebug?: (message: string) => void;
  /** Manches jouees (score de manches lu), quand c'est de la Recherche &
   *  Destruction : on ne meurt qu'une fois par manche, ce qui borne les morts
   *  de chaque joueur et ecarte des lectures impossibles ("7/71/1"). */
  maxDeaths?: number;
}

/** Lit une cellule : decoupe, pretraite, reconnait. Les parametres du moteur
 *  (liste blanche, mode) doivent deja etre regles pour le type de colonne. */
async function readCell(
  worker: Worker,
  src: ImageSource,
  rect: Rect,
  type: Column["type"],
  scale: number,
  crop: CropOptions
): Promise<OcrCell> {
  const img = await src.crop(rect, scale, crop);
  const { data } = await worker.recognize(img);
  return {
    text: data.text.trim().replace(/\s+/g, type === "text" ? " " : ""),
    confidence: Math.max(0, Math.min(1, data.confidence / 100)),
  };
}

const kdaText = (k: Kda) => `${k.kills ?? "?"}/${k.deaths ?? "?"}/${k.assists ?? "?"}`;

export async function runOcr(
  worker: Worker,
  src: ImageSource,
  template: GameTemplate,
  opts: RunOcrOptions = {}
): Promise<OcrResult> {
  const teams: OcrTeam[] = [];
  // Geometrie retenue par tableau, gardee pour les relectures de fin de chaine.
  const geometry: Array<{ table: TableTemplate; columns: Column[] }> = [];
  const rectOf = (table: TableTemplate, row: number, col: Column): Rect =>
    absRect(
      normalize(cellRect(table, row, col, src.width, src.height), src.width, src.height),
      src.width,
      src.height
    );

  for (const table of template.tables) {
    const rowCount = table.rows.bands?.length ?? table.rows.count;

    // ── Colonnes : detectees sur la capture, jamais codees en dur ───────────
    // CODM refond sa mise en page selon le ratio de l'ecran (cf. core/columns).
    // Repli sur les fractions du template si le reperage echoue.
    let columns: Column[] = table.columns;
    if (table.rows.bands?.length && table.header) {
      const detected = await detectColumns(
        worker,
        src,
        { body: table.box, header: table.header },
        table.rows.bands
      );
      if (detected) columns = detected.columns;
      opts.onDebug?.(
        `[cols ${table.side}] ` +
          (detected ? detected.detail : "NON DETECTE -> fractions par defaut")
      );
    }

    // Boucle COLONNE d'abord, puis lignes : les parametres du moteur ne
    // changent qu'a chaque colonne (3 fois) au lieu de chaque cellule (~40).
    const grid: Array<Record<string, OcrCell>> = Array.from({ length: rowCount }, () => ({}));
    for (const col of columns) {
      await setCellParams(worker, col.type);
      for (let row = 0; row < rowCount; row++) {
        grid[row][col.field] = await readCell(
          worker, src, rectOf(table, row, col), col.type, CELL_SCALE, CELL_CROP[col.type]
        );
      }
    }
    geometry.push({ table, columns });

    const players: OcrPlayer[] = [];
    for (let row = 0; row < rowCount; row++) {
      const byField = grid[row];
      const pseudoCell = byField.pseudo ?? { text: "", confidence: 0 };
      const scoreCell = byField.score ?? { text: "", confidence: 0 };
      const emaCell = byField.ema ?? { text: "", confidence: 0 };
      const ema = parseEma(emaCell.text);

      players.push({
        // surnom "(Paul)" retire : libelle d'interface, pas le pseudo en jeu.
        pseudo: cleanPseudo(pseudoCell.text),
        kills: ema.kills,
        deaths: ema.deaths,
        assists: ema.assists,
        score: parseInt0(scoreCell.text),
        is_mvp: row === 0, // board trie par score -> 1re ligne = MVP
        // confiance des STATS = cellule K/D/A. Le score et le pseudo n'entrent
        // pas ici, pour ne pas faire rejeter un match aux stats parfaites mais
        // au pseudo stylise.
        confidence: emaCell.confidence,
        pseudo_confidence: pseudoCell.confidence,
        cells: { pseudo: pseudoCell, score: scoreCell, ema: emaCell },
      });
    }

    teams.push({ side: table.side, players });
  }

  // ── Deuxieme lecture des pseudos ────────────────────────────────────────
  // Un pseudo stylise ressort rarement deux fois pareil (mesure le 03/10 : un
  // meme pseudo lu sous 7 formes differentes sur 25 captures). Une relecture
  // sous un autre pretraitement donne une seconde chance au rapprochement, qui
  // garde la plus parlante.
  await setCellParams(worker, "text");
  for (let t = 0; t < teams.length; t++) {
    const col = geometry[t].columns.find((c) => c.field === "pseudo");
    if (!col) continue;
    for (let row = 0; row < teams[t].players.length; row++) {
      const p = teams[t].players[row];
      const alt = await readCell(worker, src, rectOf(geometry[t].table, row, col), "text", CELL_SCALE, PSEUDO_ALT);
      const cleaned = cleanPseudo(alt.text);
      if (!cleaned || cleaned === p.pseudo) continue;
      // La lecture la plus sure devient le pseudo principal ; l'autre reste
      // proposee au rapprochement.
      if (!p.pseudo || alt.confidence > p.pseudo_confidence + 0.15) {
        p.pseudo_alternatives = p.pseudo ? [p.pseudo] : [];
        p.pseudo = cleaned;
        p.pseudo_confidence = alt.confidence;
        p.cells.pseudo = alt;
      } else {
        p.pseudo_alternatives = [cleaned];
      }
    }
  }

  const coherence = await checkCoherence(worker, src, teams, geometry, rectOf, opts);
  return { teams, coherence };
}

/**
 * Controle kills/morts entre les deux equipes (cf. core/coherence.ts) et, si
 * l'egalite ne tient pas, relecture des E/M/A sous d'autres pretraitements.
 * Ne touche qu'aux lignes INSTABLES ; marque chaque ligne de son verdict.
 */
async function checkCoherence(
  worker: Worker,
  src: ImageSource,
  teams: OcrTeam[],
  geometry: Array<{ table: TableTemplate; columns: Column[] }>,
  rectOf: (table: TableTemplate, row: number, col: Column) => Rect,
  opts: RunOcrOptions
): Promise<OcrCoherence> {
  const flat = teams.flatMap((t, ti) => t.players.map((p, row) => ({ t: ti, row, side: t.side, p })));
  const sized = teams.length === 2 && teams[0].players.length === teams[1].players.length && flat.length > 0;
  const asRows = () => flat.map((f) => ({ side: f.side, kda: { kills: f.p.kills, deaths: f.p.deaths, assists: f.p.assists } }));
  let lim: Limits = opts.maxDeaths ? { ...LOOSE_LIMITS, maxDeaths: opts.maxDeaths } : LOOSE_LIMITS;
  // Garde-fou de la borne : si plusieurs joueurs la depassent, ce n'est pas la
  // lecture qui est fausse mais la borne (score de manches mal lu, ou mode sans
  // manches). On l'abandonne plutot que de "corriger" des lectures justes.
  const over = flat.filter((f) => f.p.deaths !== null && f.p.deaths > lim.maxDeaths).length;
  if (over > 2) {
    opts.onDebug?.(`[coherence] borne de ${lim.maxDeaths} morts depassee par ${over} joueurs : abandonnee`);
    lim = LOOSE_LIMITS;
  }
  const invalid = () => flat.map((f) => !isValid({ kills: f.p.kills, deaths: f.p.deaths, assists: f.p.assists }, lim));

  if (!sized) {
    // Un joueur parti en cours de partie n'est plus affiche : l'egalite ne
    // peut pas tenir. On signale seulement les lectures impossibles.
    flat.forEach((f, i) => { f.p.ema_check = invalid()[i] ? "douteux" : "ok"; });
    opts.onDebug?.("[coherence] equipes de tailles differentes : controle impossible");
    return { checked: false, balanced: null, gaps: gaps(asRows()), corrected: 0 };
  }
  if (balanced(asRows()) === true && !invalid().some(Boolean)) {
    for (const f of flat) f.p.ema_check = "ok";
    return { checked: true, balanced: true, gaps: { blue: 0, red: 0 }, corrected: 0 };
  }

  // Relectures sous d'autres pretraitements : chaque passe rattrape des 7 que
  // les autres lisent 1.
  const rereads: Kda[][] = flat.map(() => []);
  await setCellParams(worker, "ema");
  for (const pass of EMA_ALT) {
    for (let i = 0; i < flat.length; i++) {
      const { t, row } = flat[i];
      const col = geometry[t].columns.find((c) => c.field === "ema");
      if (!col) continue;
      const cell = await readCell(worker, src, rectOf(geometry[t].table, row, col), "ema", pass.scale, pass.opts);
      rereads[i].push(parseEma(cell.text));
    }
  }
  const rows: RowOptions[] = flat.map((f, i) => ({
    side: f.side,
    options: rowOptions(
      f.p.cells.ema.text,
      { kills: f.p.kills, deaths: f.p.deaths, assists: f.p.assists },
      rereads[i],
      lim,
      f.p.cells.score.text
    ),
  }));

  opts.onDebug?.(
    "[coherence] options " +
      rows.map((r, i) => `${flat[i].side}${flat[i].row}=` + r.options.slice(0, 5).map((o) => `${kdaText(o.kda)}@${o.cost}`).join(",")).join(" | ")
  );
  let corrected = 0;
  const choice = searchCombination(rows, lim);
  if (choice) {
    flat.forEach((f, i) => {
      const o = rows[i].options[choice[i]].kda;
      if (choice[i] !== 0) {
        f.p.ema_original = kdaText(rows[i].options[0].kda);
        f.p.kills = o.kills; f.p.deaths = o.deaths; f.p.assists = o.assists;
        f.p.ema_check = "corrige";
        corrected++;
      } else f.p.ema_check = "ok";
    });
  } else {
    const bad = invalid().map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
    if (bad.length === 1) {
      // Une seule lecture impossible, les autres font foi : on la deduit.
      const i = bad[0];
      const d = deduceRow(asRows(), i, lim);
      if (d) {
        const f = flat[i];
        f.p.ema_original = kdaText({ kills: f.p.kills, deaths: f.p.deaths, assists: f.p.assists });
        f.p.kills = d.kills; f.p.deaths = d.deaths; f.p.assists = d.assists;
        corrected++;
      }
      flat.forEach((f, j) => { f.p.ema_check = j === i ? (d ? "deduit" : "douteux") : "ok"; });
    } else {
      // Rien de plausible ne retablit l'egalite : on ne devine pas. Sans
      // lecture impossible, l'ecart vient sans doute de la partie elle-meme
      // (suicide, bombe) ; l'appelant le signale au niveau du match.
      const inv = invalid();
      flat.forEach((f, i) => { f.p.ema_check = inv[i] ? "douteux" : "ok"; });
    }
  }
  const after = asRows();
  const res = { checked: true, balanced: balanced(after), gaps: gaps(after), corrected };
  opts.onDebug?.(`[coherence] ${JSON.stringify(res)}`);
  return res;
}

/** cellRect rend deja des pixels absolus ; on repasse par une zone relative
 *  pour reutiliser le bornage commun. */
function normalize(
  rect: { x: number; y: number; width: number; height: number },
  imgW: number,
  imgH: number
) {
  return { x: rect.x / imgW, y: rect.y / imgH, width: rect.width / imgW, height: rect.height / imgH };
}
