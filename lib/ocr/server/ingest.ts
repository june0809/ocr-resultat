import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { autoDetectTables } from "./detect";
import { anchorRows } from "./anchor";
import { runOcr, type OcrResult } from "./pipeline";
import { codmSndTablesAnchored, type GameTemplate } from "../template";
import type {
  CellField,
  MatchResponse,
  Mode,
  PlayerFields,
  PlayerOut,
  Screen,
  TeamOut,
  Warning,
} from "@/lib/schema";

/**
 * Chemin IMAGE (nominal v2) : image -> JSON §5.2, orchestration COMPLETE cote
 * serveur, sans IA (Lot A) :
 *   detect (barres bleu/rouge) -> anchor (lignes par projection) -> template
 *   ancre -> OCR par cellule (Tesseract) -> reponse par pseudo + confiances.
 * Aucune capture stockee : on lit le buffer, on rend le JSON, on jette l'image.
 */

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}
const round2 = (x: number) => Math.round(x * 100) / 100;

export type OcrImageResult =
  | { ok: true; response: MatchResponse; globalConfidence: number }
  | { ok: false; code: "unreadable_scoreboard"; detail: string };

const unreadable = (detail: string): OcrImageResult => ({
  ok: false,
  code: "unreadable_scoreboard",
  detail,
});

export async function ocrImage(
  image: Buffer,
  { game, screen }: { game: string; screen?: Screen }
): Promise<OcrImageResult> {
  let meta: Metadata;
  try {
    meta = await sharp(image).metadata();
  } catch {
    return unreadable("image non decodable");
  }
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (imgW < 2 || imgH < 2) return unreadable("dimensions image invalides");

  // Le Lot A ne sait lire QUE la mise en page S&D (2 tableaux, barres d'en-tete
  // bleue/rouge). Une liste de placement battle royale n'a pas ces reperes :
  // autoDetectTables echouerait avec un "barres non detectees" trompeur, qui
  // ferait chercher un probleme de capture au lieu d'une capacite absente.
  if (screen === "codm_br") {
    return unreadable(
      "ecran battle royale non supporte (Lot A lit uniquement les scoreboards d'equipe CODM)"
    );
  }

  const boxes = await autoDetectTables(image);
  if (!boxes) return unreadable("tableaux (barres bleu/rouge) non detectes");

  // Ancrage des lignes par projection, independamment pour chaque equipe.
  const blueBands = await anchorRows(image, boxes.blue.body, imgW, imgH);
  const redBands = await anchorRows(image, boxes.red.body, imgW, imgH);
  if (!blueBands || !redBands) return unreadable("lignes de joueurs non ancrees");

  const template: GameTemplate = {
    game,
    mode: screenToMode(screen),
    tables: codmSndTablesAnchored(
      { box: boxes.blue.body, header: boxes.blue.header, bands: blueBands },
      { box: boxes.red.body, header: boxes.red.header, bands: redBands }
    ),
  };
  const ocr = await runOcr(image, imgW, imgH, template);
  const { response, globalConfidence } = buildImageResponse(ocr, { game, screen });
  return { ok: true, response, globalConfidence };
}

function screenToMode(screen?: Screen): Mode {
  return screen === "codm_br" ? "battle_royale" : "team_deathmatch";
}

/**
 * OcrResult -> MatchResponse §5.2. Choix cles :
 *  - confidence (joueur + global) = STATS (cellule K/D/A) uniquement. Le pseudo
 *    stylise (souvent basse confiance) N'entre PAS dans la confiance qui pilote le
 *    422 -> un match aux stats parfaites n'est jamais rejete (cf. exemple §5.2 :
 *    joueur 0.94 alors que son champ pseudo est a 0.72). La confiance du pseudo
 *    vit dans fields.pseudo.confidence (surlignage orange + warning).
 *  - placement laisse NON RESOLU : l'organisateur confirme le vainqueur cote The
 *    Circle (l'humain valide avant enregistrement, §9).
 *  - source de chaque cellule = "tesseract" (repli vision = Lot B, eteint).
 */
function buildImageResponse(
  ocr: OcrResult,
  { game, screen }: { game: string; screen?: Screen }
): { response: MatchResponse; globalConfidence: number } {
  const warnThreshold = num("CONFIDENCE_WARN_THRESHOLD", 0.9);
  const warnings: Warning[] = [];
  const statConfidences: number[] = [];
  let tesseractCells = 0;

  const cell = (value: string | number, confidence: number): CellField => ({
    value,
    confidence: round2(confidence),
    source: "tesseract",
  });

  const teams: TeamOut[] = ocr.teams.map((team) => ({
    players: team.players.map((p): PlayerOut => {
      tesseractCells += 3; // pseudo + score + ema = 3 lectures/joueur
      const statConf = p.confidence; // = confiance de la cellule K/D/A
      statConfidences.push(statConf);

      if (!p.pseudo) {
        warnings.push({ code: "empty_pseudo", detail: "pseudo vide (a saisir)" });
      } else if (p.pseudo_confidence < warnThreshold) {
        warnings.push({
          code: "low_confidence_pseudo",
          player: p.pseudo,
          detail: `${p.pseudo_confidence.toFixed(2)} < ${warnThreshold.toFixed(2)}`,
        });
      }
      if (p.kills === null || p.deaths === null) {
        warnings.push({
          code: "non_numeric_stat",
          player: p.pseudo || undefined,
          detail: "K/D/A partiellement illisible",
        });
      }

      const fields: PlayerFields = {
        pseudo: cell(p.pseudo, p.pseudo_confidence),
        kills: cell(p.kills ?? 0, p.confidence),
        deaths: cell(p.deaths ?? 0, p.confidence),
        ...(p.assists !== null ? { assists: cell(p.assists, p.confidence) } : {}),
      };

      return {
        pseudo: p.pseudo, // brut, jamais corrige (§10)
        kills: p.kills ?? 0,
        deaths: p.deaths ?? 0,
        ...(p.assists !== null ? { assists: p.assists } : {}),
        is_mvp: p.is_mvp,
        confidence: round2(statConf),
        fields,
      };
    }),
  }));

  const globalConfidence =
    statConfidences.length > 0
      ? statConfidences.reduce((a, b) => a + b, 0) / statConfidences.length
      : 0;

  const response: MatchResponse = {
    match_id: randomUUID(),
    game,
    mode: screenToMode(screen),
    ...(screen ? { screen } : {}),
    captured_at: new Date().toISOString(),
    source: "the_circle",
    confidence: round2(globalConfidence),
    engine: { tesseract_cells: tesseractCells, vision_cells: 0 },
    teams,
    warnings,
  };
  return { response, globalConfidence };
}
