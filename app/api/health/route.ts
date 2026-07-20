import { NextResponse } from "next/server";

/** GET /api/health — sonde de disponibilite (pas d'auth, aucune donnee sensible). */
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ status: "ok", service: "ocr-resultat", lot: 1 });
}
