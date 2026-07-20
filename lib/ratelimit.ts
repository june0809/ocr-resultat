/**
 * Rate limiting par cle/tenant. SPEC §8 (~60 req/min, header Retry-After sur 429).
 *
 * ⚠️ IMPLEMENTATION LOT 1 : compteur EN MEMOIRE, par instance.
 * Sur Vercel (serverless), chaque instance froide a son propre compteur : ce
 * limiteur est donc APPROXIMATIF et sert a verrouiller le contrat, pas a garantir
 * un quota strict en prod. Avant la mise en charge reelle, remplacer le store par
 * un backend partage (Vercel KV / Upstash Redis) — la signature `check()` ne
 * changera pas. TODO(lot-prod): brancher un store distribue.
 */

interface Bucket {
  count: number;
  resetAt: number; // epoch ms
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Secondes a attendre avant retry (pour le header Retry-After), si bloque. */
  retryAfterSec: number;
  remaining: number;
  limit: number;
}

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/**
 * Fenetre fixe : `max` requetes par `windowSec`, par identifiant (tenant label).
 */
export function check(identifier: string): RateLimitResult {
  const max = intEnv("RATE_LIMIT_MAX", 60);
  const windowMs = intEnv("RATE_LIMIT_WINDOW_SEC", 60) * 1000;
  const now = Date.now();

  const existing = buckets.get(identifier);

  if (!existing || now >= existing.resetAt) {
    buckets.set(identifier, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0, remaining: max - 1, limit: max };
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      remaining: 0,
      limit: max,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: max - existing.count,
    limit: max,
  };
}
