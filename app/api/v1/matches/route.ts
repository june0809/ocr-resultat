import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { authenticate } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { errorResponse } from "@/lib/errors";
import { check as rateLimit } from "@/lib/ratelimit";
import { buildResponse } from "@/lib/response";
import { MatchBody } from "@/lib/schema";

/**
 * POST /v1/matches — point d'entree unique. SPEC §6.
 *
 * Pipeline Lot 1 (aucun OCR) :
 *   1. Auth par cle (§8)              -> 401 invalid_api_key
 *   2. Rate limit par tenant (§8)     -> 429 rate_limited (+ Retry-After)
 *   3. JSON + validation de schema    -> 400 invalid_body
 *   4. Chemin image (source=discord)  -> 501 ocr_not_available (Lot 4)
 *   5. Confiance globale trop basse   -> 422 unreadable_scoreboard
 *   6. Construction de la reponse §6.2 -> 200
 *
 * On execute en runtime Node (node:crypto pour l'auth et les UUID).
 */
export const runtime = "nodejs";

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cors = corsHeaders(req.headers.get("origin"));

  try {
    // 1. Auth --------------------------------------------------------------
    const tenant = authenticate(req.headers.get("authorization"));
    if (!tenant) {
      return withHeaders(
        errorResponse("invalid_api_key", "Cle d'API absente ou invalide."),
        cors
      );
    }

    // 2. Rate limit --------------------------------------------------------
    const rl = rateLimit(tenant.label);
    if (!rl.allowed) {
      return withHeaders(
        errorResponse("rate_limited", "Quota depasse, reessayez plus tard.", {
          "Retry-After": String(rl.retryAfterSec),
        }),
        cors
      );
    }

    // 3. Corps + validation ------------------------------------------------
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return withHeaders(
        errorResponse("invalid_body", "JSON malforme."),
        cors
      );
    }

    let body;
    try {
      body = MatchBody.parse(json);
    } catch (err) {
      const detail =
        err instanceof ZodError
          ? err.issues
              .map((i) => `${i.path.join(".") || "(racine)"}: ${i.message}`)
              .join(" ; ")
          : "Corps invalide.";
      return withHeaders(errorResponse("invalid_body", detail), cors);
    }

    // 4. Chemin image : OCR serveur pas encore disponible (Lot 4) ----------
    if (body.source === "discord") {
      return withHeaders(
        errorResponse(
          "ocr_not_available",
          "L'OCR cote serveur (chemin image) arrive en Lot 4. En Lot 1, envoyez le JSON deja extrait (source=web)."
        ),
        cors
      );
    }

    // 5. Construction de la reponse + seuil exploitable --------------------
    const { response, globalConfidence } = buildResponse(body);

    const minUsable = num("CONFIDENCE_MIN_USABLE", 0.5);
    if (globalConfidence < minUsable) {
      return withHeaders(
        errorResponse(
          "unreadable_scoreboard",
          `Confiance globale ${globalConfidence.toFixed(2)} sous le minimum exploitable ${minUsable.toFixed(2)}.`
        ),
        cors
      );
    }

    // 6. OK ----------------------------------------------------------------
    return withHeaders(NextResponse.json(response, { status: 200 }), cors);
  } catch (err) {
    // Ne jamais fuiter de detail interne au client.
    console.error("[/v1/matches] internal error:", err);
    return withHeaders(
      errorResponse("internal", "Erreur interne du service."),
      cors
    );
  }
}

/** Preflight CORS pour la page d'upload. */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const cors = corsHeaders(req.headers.get("origin"));
  return new NextResponse(null, { status: 204, headers: cors });
}

function withHeaders(
  res: NextResponse,
  headers: Record<string, string>
): NextResponse {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}
