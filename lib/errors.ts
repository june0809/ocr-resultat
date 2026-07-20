import { NextResponse } from "next/server";

/**
 * Format d'erreur uniforme. SPEC §6.3.
 *   { "error": { "code": "...", "message": "..." } }
 */

export type ErrorCode =
  | "invalid_body" // 400
  | "invalid_api_key" // 401
  | "unreadable_scoreboard" // 422
  | "rate_limited" // 429
  | "ocr_not_available" // 501 — specifique Lot 1 (OCR serveur pas encore la)
  | "internal"; // 500

const STATUS: Record<ErrorCode, number> = {
  invalid_body: 400,
  invalid_api_key: 401,
  unreadable_scoreboard: 422,
  rate_limited: 429,
  ocr_not_available: 501,
  internal: 500,
};

export function errorResponse(
  code: ErrorCode,
  message: string,
  extraHeaders?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status: STATUS[code], headers: extraHeaders }
  );
}
