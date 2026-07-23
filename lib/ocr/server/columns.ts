import sharp from "sharp";
import { PSM, type Worker } from "tesseract.js";
import type { Column, RowBand, TableTemplate } from "../template";

/**
 * DETECTION AUTOMATIQUE DES COLONNES (§4.2).
 *
 * Pourquoi ce module existe : des fractions de colonnes figees ne transferent
 * PAS d'un appareil a l'autre. Mesure sur les vraies captures :
 *
 *             pseudo        score        K/D/A
 *   iPad      23.6–37 %     50–57 %      65–73.5 %   (2420x1668, ratio 1.45)
 *   telephone 18.6–26 %     44.9–49.5 %  61.8–68.5 % (1600x720,  ratio 2.22)
 *
 * CODM ne se contente pas de redimensionner : il REFOND sa mise en page selon le
 * ratio de l'ecran. Toute constante calibree sur un appareil casse sur l'autre.
 *
 * Strategie : on identifie les colonnes par leur CONTENU, pas par leur position.
 *   Passe A — le K/D/A porte une signature qu'aucun autre element ne peut imiter
 *             ("15/5/0"). On le cherche a la whitelist chiffres+slash, sur la
 *             MOITIE DROITE seulement (l'avatar ne peut donc pas polluer). Le
 *             SCORE est le nombre immediatement a sa gauche.
 *   Passe B — le PSEUDO se cherche dans une fenetre calee sur le score. L'ecart
 *             pseudo->score est stable d'un appareil a l'autre (~26 % de la
 *             largeur du tableau), contrairement aux positions absolues.
 *
 * On prend la MEDIANE sur plusieurs lignes echantillons : une ligne au pseudo
 * illisible ou au badge MVP ne fausse donc pas la colonne.
 */

export interface DetectedColumns {
  columns: Column[];
  /** Diagnostic (OCR_DEBUG) : d'ou viennent les bornes. */
  detail: string;
}

interface Word {
  text: string;
  /** bornes RELATIVES a la largeur de la boite du tableau (0–1). */
  x0: number;
  x1: number;
  confidence: number;
}

/** Lignes echantillonnees pour le reperage (compromis cout/robustesse). */
const SAMPLE_ROWS = 2;
/** Marge ajoutee autour des bornes detectees, en fraction de la boite. */
const PAD = 0.012;
/** La passe "chiffres" ne regarde que la droite du tableau : au-dela de cette
 *  fraction, plus d'avatar ni de pseudo, donc aucune source de confusion. */
const NUMERIC_ZONE_START = 0.3;
/** Fenetre de recherche du pseudo, en ecart RELATIF au CENTRE du score.
 *  Mesure : le pseudo commence a centre-29.9 % (iPad) / centre-28.6 % (telephone),
 *  alors que sa position ABSOLUE varie de 5 points entre les deux. C'est cet
 *  ecart, et non la position, qui transfere d'un appareil a l'autre. */
const PSEUDO_SEARCH_FROM = 0.31;
const PSEUDO_SEARCH_TO = 0.14;
/** Fenetre de repli si l'OCR ne repere aucun pseudo : plus etroite, pour ne pas
 *  avaler l'icone "ajouter en ami" qui suit le pseudo. */
const PSEUDO_FALLBACK_FROM = 0.3;
const PSEUDO_FALLBACK_TO = 0.17;
/** Demi-largeurs des colonnes de chiffres autour du centre du libelle d'en-tete.
 *  Genereuses : la whitelist chiffres filtre tout ce qui deborde. */
const EMA_HALF = 0.07;
const SCORE_HALF = 0.05;
/** Deux mots separes de moins que ca appartiennent au meme pseudo. */
const WORD_GAP = 0.03;

/** K/D/A : 3 nombres separes par "/". Tolere les confusions OCR du separateur. */
const KDA_RE = /^(\d{1,3})[\/|lI1](\d{1,3})[\/|lI1](\d{1,3})$/;
const NUM_RE = /^\d{1,5}$/;
/** Libelles d'interface a ne jamais confondre avec un pseudo. */
const UI_TOKENS = new Set(["MVP", "VICTOIRE", "DEFAITE", "DÉFAITE", "VICTORY", "DEFEAT"]);

/** Extrait les mots + boites, quelle que soit la forme de sortie de tesseract.js. */
function wordsOf(data: unknown): Array<{ text: string; bbox: { x0: number; x1: number }; confidence: number }> {
  const d = data as {
    words?: Array<{ text: string; bbox: { x0: number; x1: number }; confidence: number }>;
    blocks?: Array<{
      paragraphs?: Array<{
        lines?: Array<{ words?: Array<{ text: string; bbox: { x0: number; x1: number }; confidence: number }> }>;
      }>;
    }>;
  };
  if (d.words?.length) return d.words;
  const out: Array<{ text: string; bbox: { x0: number; x1: number }; confidence: number }> = [];
  for (const b of d.blocks ?? [])
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? []) for (const w of l.words ?? []) out.push(w);
  return out;
}

/**
 * OCR de reperage sur une portion [from,to] (fractions de la boite) d'une bande
 * de ligne. Rend les mots avec leurs bornes RAMENEES en fractions de la boite
 * entiere, pour que l'appelant raisonne dans un seul repere.
 */
async function scanSpan(
  worker: Worker,
  image: Buffer,
  box: TableTemplate["box"],
  band: RowBand,
  imgW: number,
  imgH: number,
  from: number,
  to: number,
  whitelist: string
): Promise<Word[]> {
  const bx = Math.round(box.x * imgW);
  const by = Math.round(box.y * imgH);
  const bw = Math.min(Math.round(box.width * imgW), imgW - bx);
  const bh = Math.round(box.height * imgH);

  const left = Math.max(0, Math.min(bx + Math.round(from * bw), imgW - 2));
  const width = Math.max(2, Math.min(Math.round((to - from) * bw), imgW - left));
  // Haut de la bande : le texte y vit, l'embleme de clan est en bas.
  const top = Math.max(0, Math.min(by + Math.round(band.top * bh), imgH - 2));
  const height = Math.max(2, Math.min(Math.round(band.height * bh * 0.6), imgH - top));
  const scale = 3;

  const buf = await sharp(image)
    .extract({ left, top, width, height })
    .resize({ width: width * scale })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();

  await worker.setParameters({
    tessedit_char_whitelist: whitelist,
    tessedit_pageseg_mode: PSM.SPARSE_TEXT, // elements disperses sur la ligne
  });
  const { data } = await worker.recognize(buf, {}, { blocks: true, text: true });

  const W = width * scale;
  return wordsOf(data)
    .map((w) => ({
      text: (w.text ?? "").trim(),
      // repere local -> repere boite
      x0: from + (w.bbox.x0 / W) * (to - from),
      x1: from + (w.bbox.x1 / W) * (to - from),
      confidence: (w.confidence ?? 0) / 100,
    }))
    .filter((w) => w.text.length > 0);
}

/** Mediane (robuste aux lignes aberrantes). */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * ANCRAGE PRINCIPAL — les libelles de la barre d'en-tete.
 *
 * Amorcer la geometrie sur l'OCR des lignes de joueurs est circulaire : ce sont
 * justement les pseudos stylises que Tesseract lit mal. L'en-tete, lui, est
 * ecrit dans la police d'INTERFACE du jeu, en majuscules, sur un aplat de
 * couleur uni : c'est la zone la plus lisible de toute la capture, et elle
 * definit les colonnes par construction.
 *
 * Renvoie les CENTRES (fractions de la boite) des colonnes reperees.
 */
async function headerAnchors(
  worker: Worker,
  image: Buffer,
  header: TableTemplate["box"],
  imgW: number,
  imgH: number
): Promise<{ score?: number; ema?: number; impact?: number }> {
  const hx = Math.max(0, Math.round(header.x * imgW));
  const hy = Math.max(0, Math.round(header.y * imgH));
  const hw = Math.max(2, Math.min(Math.round(header.width * imgW), imgW - hx));
  const hh = Math.max(2, Math.min(Math.round(header.height * imgH), imgH - hy));
  const scale = 3;

  const buf = await sharp(image)
    .extract({ left: hx, top: hy, width: hw, height: hh })
    .resize({ width: hw * scale })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();

  await worker.setParameters({
    tessedit_char_whitelist: "",
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
  });
  const { data } = await worker.recognize(buf, {}, { blocks: true, text: true });
  const W = hw * scale;

  const out: { score?: number; ema?: number; impact?: number } = {};
  for (const w of wordsOf(data)) {
    const t = (w.text ?? "").trim().toUpperCase().replace(/[^A-Z\/]/g, "");
    if (!t) continue;
    const center = (w.bbox.x0 + w.bbox.x1) / 2 / W;
    // É/M/A se lit selon les captures "E/M/A", "EMA", "É/M/A", "M/A"...
    if (out.ema === undefined && (t.includes("/M/") || t === "EMA" || t === "MA")) out.ema = center;
    else if (out.score === undefined && t.startsWith("SCOR")) out.score = center;
    else if (out.impact === undefined && t.startsWith("IMPAC")) out.impact = center;
  }
  return out;
}

/**
 * Repere les colonnes en lisant quelques lignes. Renvoie null si le K/D/A n'est
 * trouve sur aucune ligne echantillon (capture non exploitable -> l'appelant
 * retombe sur les fractions par defaut du template).
 */
export async function detectColumns(
  worker: Worker,
  image: Buffer,
  boxes: { body: TableTemplate["box"]; header: TableTemplate["box"] },
  bands: RowBand[],
  imgW: number,
  imgH: number
): Promise<DetectedColumns | null> {
  const box = boxes.body;
  // Echantillon reparti sur la hauteur (evite de ne tomber que sur la ligne MVP).
  const idx: number[] = [];
  const stepI = Math.max(1, Math.floor(bands.length / SAMPLE_ROWS));
  for (let i = 0; i < bands.length && idx.length < SAMPLE_ROWS; i += stepI) idx.push(i);

  // ── Ancrage 1 (principal) : les libelles de l'en-tete ────────────────────
  const head = await headerAnchors(worker, image, boxes.header, imgW, imgH);

  let emaX0: number | undefined;
  let emaX1: number | undefined;
  let scoreX0: number | undefined;
  let scoreX1: number | undefined;
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
  // Sert uniquement si l'en-tete n'a pas ete lu (capture rognee, langue exotique).
  if (emaX0 === undefined) {
    const kda0: number[] = [];
    const kda1: number[] = [];
    const sco0: number[] = [];
    const sco1: number[] = [];
    for (const i of idx) {
      const words = await scanSpan(
        worker, image, box, bands[i], imgW, imgH,
        NUMERIC_ZONE_START, 1, "0123456789/"
      );
      const kda = words.find((w) => KDA_RE.test(w.text));
      if (!kda) continue;
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
    if (kda0.length === 0) return null; // ni en-tete ni K/D/A : capture inexploitable
    emaX0 = median(kda0);
    emaX1 = median(kda1);
    if (scoreX0 === undefined) {
      scoreX0 = sco0.length ? median(sco0) : emaX0 - 0.12;
      scoreX1 = sco1.length ? median(sco1) : emaX0 - 0.05;
    }
    source = "lignes (repli)";
  }
  if (emaX0 === undefined || emaX1 === undefined) return null;
  if (scoreX0 === undefined || scoreX1 === undefined) {
    scoreX0 = emaX0 - 0.12;
    scoreX1 = emaX0 - 0.05;
  }
  // Bornes desormais certaines : on fige pour que le typage suive.
  const ema0 = emaX0;
  const ema1 = emaX1;
  const sc0 = scoreX0;
  const sc1 = scoreX1;

  // ── Passe pseudo : fenetre calee sur le score, affinee par OCR ───────────
  // L'ecart pseudo->score est stable d'un appareil a l'autre (~29 % de la
  // largeur du tableau), contrairement aux positions absolues.
  const scoreCenter = (sc0 + sc1) / 2;
  const searchFrom = Math.max(0, scoreCenter - PSEUDO_SEARCH_FROM);
  const searchTo = Math.max(searchFrom + 0.02, scoreCenter - PSEUDO_SEARCH_TO);
  const pse0: number[] = [];
  const pse1: number[] = [];

  for (const i of idx) {
    const words = (
      await scanSpan(worker, image, box, bands[i], imgW, imgH, searchFrom, searchTo, "")
    )
      .filter(
        (w) =>
          w.confidence > 0.3 &&
          !UI_TOKENS.has(w.text.toUpperCase()) &&
          !NUM_RE.test(w.text) &&
          /[A-Za-z]/.test(w.text)
      )
      .sort((a, b) => a.x0 - b.x0);
    if (!words.length) continue;

    // Le pseudo est le PREMIER groupe de mots contigus : on s'arrete au premier
    // vrai trou. Ca coupe naturellement avant l'icone "ajouter en ami" et le
    // badge MVP, qui sont separes du pseudo par un blanc franc.
    let x0 = words[0].x0;
    let x1 = words[0].x1;
    for (let k = 1; k < words.length; k++) {
      if (words[k].x0 - x1 > WORD_GAP) break;
      x1 = words[k].x1;
    }
    pse0.push(x0);
    pse1.push(x1);
  }

  // Sans pseudo repere, fenetre de repli resserree (evite l'icone "ami").
  const pseudoX0 = pse0.length ? median(pse0) : Math.max(0, scoreCenter - PSEUDO_FALLBACK_FROM);
  const pseudoX1 = pse1.length ? Math.max(...pse1) : scoreCenter - PSEUDO_FALLBACK_TO;

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const mk = (
    field: Column["field"],
    type: Column["type"],
    x0: number,
    x1: number,
    yHeight?: number
  ): Column => {
    const a = clamp01(x0 - PAD);
    const b = clamp01(x1 + PAD);
    return { field, type, x: a, width: Math.max(0.01, b - a), ...(yHeight ? { yHeight } : {}) };
  };

  const pct = (v: number) => (v * 100).toFixed(1);
  return {
    columns: [
      // yHeight 0.55 : ne lit que le haut de la ligne, pas l'embleme du bas.
      mk("pseudo", "text", pseudoX0, pseudoX1, 0.55),
      mk("score", "int", sc0, sc1),
      mk("ema", "ema", ema0, ema1),
    ],
    detail:
      `[${source}] pseudo ${pct(pseudoX0)}-${pct(pseudoX1)}% (${pse0.length}/${idx.length}) | ` +
      `score ${pct(sc0)}-${pct(sc1)}% | kda ${pct(ema0)}-${pct(ema1)}%`,
  };
}
