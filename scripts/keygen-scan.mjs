import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Configure la page de saisie en une commande : `npm run keygen:scan`.
 *
 * Pourquoi ce script en plus de keygen : la mise en route demandait de generer
 * une paire, puis de recopier le HASH dans une variable et la CLE BRUTE dans une
 * autre, sans les intervertir ni relancer la generation entre les deux. Trois
 * occasions de se tromper pour une operation purement mecanique — et un echec y
 * donne un 401 qui n'explique rien.
 *
 * Le script ecrit donc les deux valeurs au bon endroit dans .env.local, et
 * PRESERVE les entrees API_KEYS existantes (celle de The Circle, notamment).
 *
 * Il n'affiche jamais le secret : il vit dans .env.local, qui est gitignore.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const ENV = path.join(ROOT, ".env.local");
const LABEL = (process.argv[2] ?? "page-saisie").replace(/[^a-z0-9_-]/gi, "-");

const key = "sk_" + randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(key, "utf8").digest("hex");
const entree = `${hash}:${LABEL}`;

let contenu = existsSync(ENV)
  ? readFileSync(ENV, "utf8")
  : existsSync(path.join(ROOT, ".env.example"))
    ? readFileSync(path.join(ROOT, ".env.example"), "utf8")
    : "";

/** Valeur d'une variable, guillemets retires. */
function lire(nom) {
  const m = contenu.match(new RegExp(`^\\s*${nom}\\s*=\\s*(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** Pose ou remplace une variable, en conservant le reste du fichier. */
function poser(nom, valeur) {
  const ligne = `${nom}="${valeur}"`;
  const re = new RegExp(`^\\s*${nom}\\s*=.*$`, "m");
  contenu = re.test(contenu)
    ? contenu.replace(re, ligne)
    : contenu.replace(/\s*$/, "") + `\n${ligne}\n`;
}

// API_KEYS : on AJOUTE notre entree aux existantes. Ecraser la variable
// couperait l'acces des autres clients (The Circle) sans prevenir.
const existant = (lire("API_KEYS") ?? "")
  .split(",")
  .map((e) => e.trim())
  .filter((e) => e && !e.startsWith("<") && !e.endsWith(`:${LABEL}`));

poser("API_KEYS", [...existant, entree].join(","));
poser("SCAN_API_KEY", key);

writeFileSync(ENV, contenu, "utf8");

console.log(`
  Cle generee pour "${LABEL}" et ecrite dans .env.local :
    - API_KEYS      : ${existant.length} entree(s) conservee(s) + la nouvelle
    - SCAN_API_KEY  : posee

  La cle n'est volontairement pas affichee ici : elle est deja au bon endroit,
  et .env.local est gitignore.

  Lance maintenant :  npm run dev     puis ouvre  http://localhost:3000/scan

  Pour la mise en ligne, reporte ces deux variables dans les Environment
  Variables du projet Vercel (leur valeur se lit dans .env.local).
`);
