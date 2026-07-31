import { NextRequest, NextResponse } from "next/server";

/**
 * RELAIS de la page de saisie vers /v1/matches.
 *
 * Raison d'etre : la page tourne dans le navigateur de l'organisateur. Y placer
 * la cle d'API reviendrait a la publier — tout visiteur lirait `sk_...` dans les
 * sources ou dans l'onglet reseau, et pourrait ensuite appeler le service en
 * notre nom depuis n'importe ou. Une cle dans du JS client est une cle publique.
 *
 * La page appelle donc CETTE route en same-origin, sans aucun secret ; la cle
 * est lue ici, cote serveur, depuis l'environnement.
 *
 * On relaie vers l'endpoint public plutot que d'appeler la logique en direct :
 * la page emprunte ainsi exactement le contrat que suit The Circle (auth, rate
 * limit, validation, 422). Si le contrat casse, la page casse — c'est voulu, ca
 * nous le signale avant que le client ne le decouvre.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/** Le corps transite tel quel ; seule sa TAILLE est verifiee ici, pour ne pas
 *  transformer le relais en amplificateur (le chemin image porte du base64). */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const key = process.env.SCAN_API_KEY?.trim();
  if (!key) {
    // Diagnostic explicite : sans ca, l'erreur remonterait en 401 et on
    // chercherait un probleme de cle alors que la variable n'est pas posee.
    return NextResponse.json(
      {
        error: {
          code: "scan_not_configured",
          message:
            "SCAN_API_KEY absente de l'environnement : la page de saisie ne peut pas appeler le service.",
        },
      },
      { status: 503 }
    );
  }

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: { code: "payload_too_large", message: "Capture trop lourde." } },
      { status: 413 }
    );
  }

  // Meme deploiement : on vise notre propre endpoint, sans supposer le domaine.
  const target = new URL("/v1/matches", req.nextUrl.origin);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
    });
  } catch (err) {
    console.error("[/api/scan] relais injoignable:", err);
    return NextResponse.json(
      { error: { code: "upstream_unreachable", message: "Service d'ingestion injoignable." } },
      { status: 502 }
    );
  }

  // On rend la reponse du service TELLE QUELLE (statut compris) : la page doit
  // voir les vrais 422 / 429 et les afficher, pas une version edulcoree.
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
