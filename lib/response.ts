import { randomUUID } from "node:crypto";
import type {
  MatchResponse,
  TeamOut,
  Warning,
  WebMatchBody,
} from "./schema";

/**
 * Construit la reponse du §6.2 a partir du JSON deja extrait cote navigateur.
 *
 * - Le service genere `match_id` et `captured_at` lui-meme (§6.2).
 * - `confidence` global = moyenne des confidences joueurs (coherent avec
 *   l'exemple du SPEC : 0.94 & 0.88 -> 0.91).
 * - `warnings` : cellules sous le seuil, placements en double (§5.3).
 * - Les pseudos sont recopies BRUTS, jamais corriges (§12).
 */

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

export interface BuildResult {
  response: MatchResponse;
  /** Confiance globale ; si sous le minimum exploitable -> 422 cote handler. */
  globalConfidence: number;
}

export function buildResponse(body: WebMatchBody): BuildResult {
  const warnThreshold = num("CONFIDENCE_WARN_THRESHOLD", 0.9);

  const warnings: Warning[] = [];
  const confidences: number[] = [];

  const teams: TeamOut[] = body.extracted.teams.map((team) => ({
    placement: team.placement,
    players: team.players.map((p) => {
      // confidence optionnelle -> 1.0 par defaut (lecture web deja propre).
      const confidence = p.confidence ?? 1;
      confidences.push(confidence);

      if (confidence < warnThreshold) {
        warnings.push({
          code: "low_confidence_pseudo",
          player: p.pseudo,
          detail: `${confidence.toFixed(2)} < ${warnThreshold.toFixed(2)}`,
        });
      }

      return {
        pseudo: p.pseudo, // brut, non modifie
        kills: p.kills,
        deaths: p.deaths,
        ...(p.assists !== undefined ? { assists: p.assists } : {}),
        ...(p.placement !== undefined ? { placement: p.placement } : {}),
        ...(p.is_mvp !== undefined ? { is_mvp: p.is_mvp } : {}),
        confidence,
      };
    }),
  }));

  // Placements de team en double (battle_royale). §5.3 : valeur incoherente.
  if (body.mode === "battle_royale") {
    const seen = new Map<number, number>();
    for (const t of body.extracted.teams) {
      if (t.placement === undefined) continue;
      seen.set(t.placement, (seen.get(t.placement) ?? 0) + 1);
    }
    for (const [placement, count] of seen) {
      if (count > 1) {
        warnings.push({
          code: "duplicate_placement",
          detail: `placement ${placement} present ${count} fois`,
        });
      }
    }
  }

  const globalConfidence =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;

  const response: MatchResponse = {
    match_id: randomUUID(),
    game: body.game,
    mode: body.mode,
    // heure reelle du match si fournie par le client, sinon heure serveur.
    captured_at: body.captured_at ?? new Date().toISOString(),
    source: "web",
    confidence: Number(globalConfidence.toFixed(2)),
    teams,
    warnings,
  };

  return { response, globalConfidence };
}
