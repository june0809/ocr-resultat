/**
 * CORS pour la page d'upload navigateur. SPEC §8 : whitelist du domaine connu.
 * `ALLOWED_ORIGIN` vide => aucun header CORS (appels same-origin / serveur seul).
 */

export function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowed = process.env.ALLOWED_ORIGIN?.trim();
  if (!allowed) return {};
  if (requestOrigin && requestOrigin === allowed) {
    return {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    };
  }
  return {};
}
