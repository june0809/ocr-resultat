import { NextResponse } from "next/server";
import { countKeys } from "@/lib/auth";

/** GET /api/health — sonde de disponibilite (pas d'auth, aucune donnee sensible).
 *  `keys_loaded` = nombre de cles vues par ce deploiement (diagnostic de config
 *  API_KEYS). Ne revele ni les cles ni les hash. Retirable une fois le setup ok. */
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "ocr-resultat",
    lot: 1,
    keys_loaded: countKeys(),
  });
}
