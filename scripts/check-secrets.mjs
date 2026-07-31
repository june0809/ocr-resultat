import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Refuse de laisser un secret entrer dans le depot.
 *
 * Pourquoi ce banc existe : une cle d'API de production a deja ete commitee en
 * clair dans scripts/ocr-e2e.mjs. Le fichier a ensuite ete supprime, mais un
 * depot public conserve son historique — la cle est restee lisible par n'importe
 * qui, et valide, longtemps apres sa « suppression ». Supprimer un fichier ne
 * revoque rien.
 *
 * On controle donc les fichiers SUIVIS a chaque PR. C'est un filet, pas une
 * garantie : il attrape la recidive evidente (une cle collee dans un script de
 * test), pas un secret encode. La vraie defense reste de ne jamais ecrire de
 * secret dans un fichier du repo — les cles vivent dans l'environnement.
 *
 * `npm run check:secrets`.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

/** Motifs de secrets. `allow` laisse passer les formes manifestement factices
 *  (documentation, exemples), sans quoi le banc crierait sur le README. */
const PATTERNS = [
  {
    name: "cle d'API du service (sk_...)",
    re: /\bsk_[A-Za-z0-9_-]{16,}\b/g,
    allow: /^sk_(VOTRE|TON|MA|xxx|XXX|test|TEST|\.\.\.|<)/,
  },
  { name: "token GitHub", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: "cle AWS", re: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    name: "token Grafana / service (glc_, glsa_)",
    re: /\bgl[cs]a?_[A-Za-z0-9+/=_-]{20,}\b/g,
  },
  { name: "cle privee PEM", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

/** Fichiers a ne pas inspecter : binaires, et ce banc lui-meme (qui contient les
 *  motifs par construction). */
const SKIP = /\.(png|jpe?g|webp|gif|ico|traineddata|tgz|zip|pdf)$|^scripts\/check-secrets\.mjs$/;

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((f) => !SKIP.test(f));

let found = 0;
for (const rel of tracked) {
  let text;
  try {
    text = readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    continue; // binaire ou illisible
  }
  const lines = text.split(/\r?\n/);
  for (const { name, re, allow } of PATTERNS) {
    lines.forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        if (allow?.test(m[0])) continue;
        // On n'affiche jamais le secret en entier : le journal de CI est lui
        // aussi consultable.
        console.error(`  ${rel}:${i + 1}  ${name} -> ${m[0].slice(0, 6)}...`);
        found++;
      }
    });
  }
}

console.log(
  found === 0
    ? `\n==== aucun secret dans les ${tracked.length} fichiers suivis ====`
    : `\n==== ${found} secret(s) potentiel(s) : a retirer ET a REVOQUER ====`
);
if (found > 0) {
  console.error(
    "\nRetirer la valeur du fichier ne suffit pas : si le commit a ete pousse,\n" +
      "considerer le secret comme compromis et le regenerer."
  );
}
process.exit(found > 0 ? 1 : 0);
