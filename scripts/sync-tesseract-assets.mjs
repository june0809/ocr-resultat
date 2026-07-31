import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Copie les fichiers d'execution de Tesseract dans public/, pour que la page de
 * saisie les serve depuis NOTRE domaine.
 *
 * Pourquoi ne pas laisser tesseract.js aller les chercher tout seul : par defaut
 * il les telecharge depuis un CDN public. Trois consequences qu'on ne veut pas —
 * la page cesse de fonctionner si le CDN tombe ou est filtre (reseau
 * d'entreprise, pays bloquant), chaque organisateur signale sa presence a un
 * tiers, et la version servie peut changer sous nos pieds sans qu'on l'ait
 * decide.
 *
 * Pourquoi une COPIE plutot que des fichiers commites : ca represente ~34 Mo de
 * binaires. Les committer alourdirait le depot a chaque mise a jour de
 * tesseract.js, pour des fichiers dont node_modules detient deja la version
 * juste. Le dossier est donc genere (et gitignore), regenere avant chaque `dev`
 * et chaque `build`.
 *
 * Lance automatiquement par les scripts `predev` / `prebuild`.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "tesseract");

/** Le moteur tourne en LSTM seul (createWorker("eng", 1) -> OEM 1), donc les
 *  variantes "-lstm" suffiraient. On copie le dossier entier malgre tout : le
 *  nom exact du fichier choisi depend du support SIMD detecte dans le
 *  navigateur, et un 404 la-dessus se diagnostique tres mal depuis un poste
 *  utilisateur. Quelques Mo de plus valent mieux qu'un echec silencieux. */
const SOURCES = [
  {
    from: "node_modules/tesseract.js/dist/worker.min.js",
    to: "worker.min.js",
    role: "script du worker",
  },
  { from: "node_modules/tesseract.js-core", to: "core", role: "coeur WASM" },
  {
    // best_int : modele plus precis que le 4.0.0 standard sur les polices de jeu,
    // et 3,7x plus leger (2,9 Mo contre 10,7). C'est celui que le moteur utilise
    // deja cote serveur — on sert donc le MEME modele des deux cotes, sinon le
    // banc ne dirait plus la verite sur ce que lit l'utilisateur.
    from: "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    to: "lang/eng.traineddata.gz",
    role: "modele de langue",
  },
];

const mo = (p) => {
  let total = 0;
  const walk = (f) => {
    const s = statSync(f);
    if (s.isDirectory()) for (const e of readdirSync(f)) walk(path.join(f, e));
    else total += s.size;
  };
  walk(p);
  return (total / 1024 / 1024).toFixed(1);
};

rmSync(OUT, { recursive: true, force: true });

let missing = 0;
for (const { from, to, role } of SOURCES) {
  const src = path.join(ROOT, from);
  if (!existsSync(src)) {
    console.error(`  MANQUANT  ${from} (${role}) — lance 'npm install'`);
    missing++;
    continue;
  }
  const dest = path.join(OUT, to);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`  ${to.padEnd(24)} ${role} (${mo(src)} Mo)`);
}

if (missing > 0) process.exit(1);
console.log(`\nAssets Tesseract servis depuis /tesseract/ (public/tesseract, non commite).`);
