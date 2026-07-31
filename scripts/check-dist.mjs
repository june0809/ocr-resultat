import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Verifie que dist/ (commite) correspond bien a lib/ocr/ (source).
 *
 * Contrepartie de la decision de committer le build : sans ce garde-fou, un
 * dist/ oublie apres modification du moteur livrerait du code PERIME au
 * consommateur, sans qu'aucun test de ce repo ne bronche — les tests locaux
 * compilent la source, pas le dist publie.
 *
 * `tsc -p tsconfig.build.json` est deterministe (verifie : deux builds
 * successifs produisent des fichiers identiques au hash pres), donc un
 * `git diff` non vide signifie exactement une chose : quelqu'un a modifie
 * lib/ocr/ sans relancer `npm run build:engine`.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: true });

console.log("→ npm run build:engine");
run("npm", ["run", "build:engine"]);

// Deux questions distinctes, d'ou deux commandes :
//   - un fichier COMMITE a-t-il change (ou disparu) ? -> diff contre HEAD, en
//     ignorant l'index : on compare le build qui vient de sortir a ce qui est
//     reellement livre, pas a ce qui se trouve stage.
//   - un fichier NEUF est-il apparu (nouveau module du moteur) ? -> il ne serait
//     dans aucun diff, seulement dans les fichiers non suivis.
const changed = run("git", ["diff", "--name-status", "HEAD", "--", "dist"]).trim();
const untracked = run("git", ["ls-files", "--others", "--exclude-standard", "--", "dist"]).trim();

if (changed || untracked) {
  console.error("\n==== dist/ N'EST PAS A JOUR ====");
  if (changed) console.error(changed);
  if (untracked) console.error(untracked.split("\n").map((f) => `?? ${f}`).join("\n"));
  console.error("\nLance `npm run build:engine` et commite dist/.");
  process.exit(1);
}

console.log("\n==== dist/ est a jour ====");
