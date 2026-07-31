import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Verifie que le paquet est CONSOMMABLE par une application tierce (The Circle).
 *
 * Pourquoi ce banc existe : `npm run build` et `npm run typecheck` valident le
 * code de CE repo, jamais la surface publiee. Un champ "exports" errone, un
 * fichier absent de "files" ou un dist/ non commite passent donc tous les
 * controles locaux — et cassent le consommateur.
 *
 * -- Le mode de panne qu'on garde ferme --------------------------------------
 * The Circle installe depuis git ("github:june0809/ocr-resultat#<sha>"). npm
 * clone alors le repo, puis compte sur le script "prepare" pour produire dist/.
 * Quand les scripts d'install sont desactives (npm --ignore-scripts, config
 * d'entreprise, CI durcie), prepare ne tourne pas : le paquet s'installe VIDE,
 * npm sort en SUCCES ("added 21 packages, found 0 vulnerabilities"), et le
 * consommateur casse plus tard sur un MODULE_NOT_FOUND qui ne designe pas la
 * cause. D'ou dist/ commite — et d'ou ce banc, qui verifie que ca le reste.
 *
 * -- Comment on le reproduit sans reseau -------------------------------------
 * Un `npm pack` ordinaire ne suffirait PAS : pack declenche prepare, donc il
 * fabriquerait un dist/ meme si le repo n'en contenait aucun — le banc passerait
 * au vert sur un paquet casse. On reconstitue donc le clone que npm ferait, a
 * partir des SEULS fichiers suivis par git (`git ls-files`), puis on packe avec
 * --ignore-scripts. Ce qui sort du tarball est exactement ce que The Circle
 * recevrait.
 *
 * `npm run check:package`.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

/** Exports du package.json et ce qu'on exige de chacun.
 *  `load: false` pour ./server : il charge sharp (binaire natif) — on verifie
 *  qu'il est bien LIVRE, pas que la machine de CI sait executer sharp. */
const ENTRIES = [
  { specifier: "ocr-resultat/pseudo", load: true },
  { specifier: "ocr-resultat/template", load: true },
  { specifier: "ocr-resultat/browser", load: true },
  { specifier: "ocr-resultat/server", load: false },
];

/** git est un vrai executable : appel direct, arguments non interpretes. */
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** npm, lui, est un .cmd sous Windows, que Node 24 refuse de lancer sans shell
 *  (spawnSync EINVAL, mitigation CVE-2024-27980). On passe donc par un shell,
 *  en quotant nous-memes : le repo vit sous un chemin a espaces
 *  ("D:\\Stage\\The circle\\..."), qu'un shell decouperait en deux arguments. */
const q = (s) => `"${s}"`;
const npm = (command, cwd) => execSync(`npm ${command}`, { cwd, encoding: "utf8" });

const tmp = mkdtempSync(path.join(tmpdir(), "ocr-resultat-pkg-"));
let failures = 0;
const fail = (msg) => {
  console.error(`  ECHEC  ${msg}`);
  failures++;
};

try {
  // 1. Reconstitue le clone que npm ferait : fichiers SUIVIS PAR GIT seulement.
  //    Un dist/ present sur le disque mais non commite ne passera donc pas.
  const clone = path.join(tmp, "clone");
  const tracked = git(["ls-files", "-z"], ROOT).split("\0").filter(Boolean);
  for (const rel of tracked) {
    const dest = path.join(clone, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(ROOT, rel), dest);
  }
  const shipped = tracked.filter((f) => f.startsWith("dist/"));
  console.log(
    `-> clone reconstitue : ${tracked.length} fichiers suivis, dont ${shipped.length} dans dist/`
  );
  if (shipped.length === 0) {
    fail(
      "aucun fichier dist/ suivi par git — le paquet s'installerait VIDE sans le script prepare"
    );
  }

  // 2. Packe SANS scripts : pas de prepare, donc pas de dist/ fabrique au vol.
  console.log("-> npm pack --ignore-scripts");
  npm(`pack --ignore-scripts --pack-destination ${q(tmp)}`, clone);
  const tarball = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack n'a produit aucun tarball");
  console.log(`   ${tarball}`);

  // 3. Installe dans un projet jetable, sans scripts la aussi ----------------
  const consumer = path.join(tmp, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", version: "1.0.0", private: true }) + "\n"
  );

  console.log("-> npm install --ignore-scripts (cas d'une CI durcie)");
  npm(
    `install --ignore-scripts --no-audit --no-fund ${q(path.join(tmp, tarball))}`,
    consumer
  );

  // 4. Chaque export declare doit se resoudre ET se charger ------------------
  console.log("-> verification des exports");
  const require_ = createRequire(path.join(consumer, "index.cjs"));
  for (const { specifier, load } of ENTRIES) {
    try {
      require_.resolve(specifier);
      if (load) require_(specifier);
      console.log(`  OK     ${specifier}${load ? "" : " (resolution seule)"}`);
    } catch (err) {
      fail(`${specifier} -> ${err.code ?? "erreur"} : ${String(err.message).split("\n")[0]}`);
    }
  }

  // 5. Controle de fumee : la lib livree fait bien quelque chose -------------
  try {
    const { cleanPseudo } = require_("ocr-resultat/pseudo");
    const got = cleanPseudo("AZ-Alk_pc (Paul)");
    if (got !== "AZ-Alk_pc") fail(`cleanPseudo rend "${got}", attendu "AZ-Alk_pc"`);
    else console.log('  OK     cleanPseudo("AZ-Alk_pc (Paul)") === "AZ-Alk_pc"');
  } catch (err) {
    fail(`cleanPseudo injouable : ${String(err.message).split("\n")[0]}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(
  failures === 0
    ? "\n==== paquet consommable ===="
    : `\n==== ${failures} echec(s) : le paquet CASSERAIT chez le consommateur ====`
);
process.exit(failures > 0 ? 1 : 0);
