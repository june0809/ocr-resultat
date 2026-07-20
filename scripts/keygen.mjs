import { randomBytes, createHash } from "node:crypto";

/**
 * Genere une paire (cle brute + hash SHA-256) pour un tenant.
 *
 *   npm run keygen -- the-circle
 *
 * - Donne la cle BRUTE (sk_...) au client, une seule fois, par canal sur.
 * - Mets le HASH (hash:label) dans la variable d'env API_KEYS du service.
 * Le service ne stocke jamais la cle en clair (SPEC §8).
 */

const label = (process.argv[2] ?? "tenant").replace(/[^a-z0-9_-]/gi, "-");

const key = "sk_" + randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(key, "utf8").digest("hex");

console.log("");
console.log("  Tenant      :", label);
console.log("  Cle (BRUTE) :", key, "  <- a donner au client, une seule fois");
console.log("  Entree env  :", `${hash}:${label}`, "  <- a mettre dans API_KEYS");
console.log("");
