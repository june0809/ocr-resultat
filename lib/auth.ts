import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Auth par cle d'API. SPEC §8.
 *
 * - Header attendu : `Authorization: Bearer sk_<cle>`
 * - Les cles ne sont JAMAIS stockees en clair : on compare le SHA-256 de la cle
 *   presentee aux hash configures dans l'env `API_KEYS`.
 * - La cle identifie le tenant (label), utilise pour le rate-limiting et les logs.
 *
 * Format env `API_KEYS` : "hash1:label1,hash2:label2"
 */

export interface Tenant {
  /** Label du tenant (ex. "the-circle"). Sert de cle de rate-limit et de log. */
  label: string;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Compare deux hex de meme longueur en temps constant. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Retire espaces et guillemets (") ou (') englobants — evite le piege du
 *  copier-coller depuis .env.example ou de l'UI Vercel. */
function clean(s: string): string {
  return s.trim().replace(/^['"]+|['"]+$/g, "").trim();
}

function loadKeys(): Map<string, Tenant> {
  const raw = clean(process.env.API_KEYS ?? "");
  const map = new Map<string, Tenant>();
  for (const entry of raw.split(",")) {
    const trimmed = clean(entry);
    if (!trimmed) continue;
    const [hash, label] = trimmed.split(":");
    if (!hash || !label) continue;
    map.set(clean(hash).toLowerCase(), { label: clean(label) });
  }
  return map;
}

/**
 * Nombre de cles vues par ce deploiement (diagnostic de config).
 * Ne revele NI les cles NI les hash — juste le compte. Sert a verifier que la
 * variable d'env API_KEYS est bien presente dans l'environnement de prod.
 */
export function countKeys(): number {
  return loadKeys().size;
}

/**
 * Extrait et verifie la cle du header Authorization.
 * @returns le tenant si la cle est valide, sinon null.
 */
export function authenticate(authHeader: string | null): Tenant | null {
  if (!authHeader) return null;

  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return null;

  const presented = match[1].trim();
  if (!presented.startsWith("sk_")) return null;

  const presentedHash = sha256Hex(presented);
  const keys = loadKeys();

  for (const [hash, tenant] of keys) {
    if (safeEqualHex(presentedHash, hash)) return tenant;
  }
  return null;
}
