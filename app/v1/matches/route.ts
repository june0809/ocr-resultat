import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { authenticate } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { errorResponse } from "@/lib/errors";
import { check as rateLimit } from "@/lib/ratelimit";
import { buildResponse } from "@/lib/response";
import { ocrImage } from "@/lib/ocr/server/ingest";
import { MatchBody, type MatchResponse } from "@/lib/schema";

/**
 * POST /v1/matches — point d'entree unique. SPEC §6.
 *
 * Pipeline Lot 1 (aucun OCR) :
 *   1. Auth par cle (§8)              -> 401 invalid_api_key
 *   2. Rate limit par tenant (§8)     -> 429 rate_limited (+ Retry-After)
 *   3. JSON + validation de schema    -> 400 invalid_body
 *   4. Chemin image (source=the_circle) -> ocr_not_available tant que le moteur Lot A n'est pas cable
 *   5. Confiance globale trop basse   -> 422 unreadable_scoreboard
 *   6. Construction de la reponse §6.2 -> 200
 *
 * On execute en runtime Node (node:crypto pour l'auth et les UUID).
 */
export const runtime = "nodejs";
// L'OCR serveur (tesseract.js + sharp) prend quelques secondes ; Hobby autorise
// jusqu'a 60 s via maxDuration -> on prend de la marge (nominal ~1 s/board).
export const maxDuration = 60;

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

    // 4. Construction de la reponse selon le chemin -----------------------
    let response: MatchResponse;
    let globalConfidence: number;

    if (body.source === "the_circle") {
      // Chemin image (nominal v2) : OCR serveur complet (detect -> anchor ->
      // template -> Tesseract). On lit l'image, on rend le JSON, on la jette.
      const image = Buffer.from(body.image_base64, "base64");
      const maxBytes = num("IMAGE_MAX_BYTES", 8 * 1024 * 1024);
      if (image.length === 0) {
        return withHeaders(
          errorResponse("invalid_body", "image_base64 vide ou invalide."),
          cors
        );
      }
      if (image.length > maxBytes) {
        return withHeaders(
          errorResponse(
            "invalid_body",
            `Image trop lourde (> ${Math.round(maxBytes / 1024 / 1024)} Mo).`
          ),
          cors
        );
      }
      const result = await ocrImage(image, {
        game: body.game,
        screen: body.screen,
      });
      if (!result.ok) {
        return withHeaders(errorResponse(result.code, result.detail), cors);
      }
      response = result.response;
      globalConfidence = result.globalConfidence;
    } else {
      // Chemin "JSON deja extrait" (compat / tests, §5.1).
      const built = buildResponse(body);
      response = built.response;
      globalConfidence = built.globalConfidence;
    }

    // 5. Seuil exploitable (partage) --------------------------------------
    // Seuil bas volontairement : le flux nominal passe TOUJOURS par la validation
    // humaine (§9). Le 422 ne doit rejeter qu'un scoreboard vraiment illisible, pas
    // un match aux chiffres bons mais pseudos stylises (basse confiance attendue).
    const minUsable = num("CONFIDENCE_MIN_USABLE", 0.3);
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
