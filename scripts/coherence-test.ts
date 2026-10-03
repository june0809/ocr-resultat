import {
  balanced,
  confusionCandidates,
  deduceRow,
  killsRange,
  rowOptions,
  searchCombination,
  LOOSE_LIMITS,
  type Kda,
  type Limits,
  type RowOptions,
} from "../lib/ocr/core/coherence";

/**
 * Garde-fous du controle de coherence des E/M/A (lib/ocr/core/coherence.ts).
 * Fonctions pures : aucun tesseract, aucune image. `npm run test:coherence`.
 *
 * Les cas reprennent les VRAIES erreurs relevees le 03/10 sur des captures de
 * tournoi (chiffres seulement) : le 7 de la police CODM lu comme un 1.
 */

let ok = 0;
let ko = 0;
const t = (label: string, got: unknown, want: unknown) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  good ? ok++ : ko++;
  console.log(`${good ? "OK   " : "ECHEC"} ${label} -> ${JSON.stringify(got)}${good ? "" : `   (attendu ${JSON.stringify(want)})`}`);
};
const k = (s: string): Kda => {
  const [kills, deaths, assists] = s.split("/").map((x) => (x === "?" ? null : +x));
  return { kills, deaths, assists };
};
const txt = (x: Kda) => `${x.kills}/${x.deaths}/${x.assists}`;

// ── Candidats d'erreurs connues ───────────────────────────────────────────
const has = (raw: string, want: string) => confusionCandidates(raw).some((c) => txt(c.kda) === want);
t("7/1/0 -> 7/7/0 (un 7 lu 1)", has("7/1/0", "7/7/0"), true);
t("2/17/1 -> 2/7/1 (1 parasite)", has("2/17/1", "2/7/1"), true);
t("11/1 -> 7/7/1 (barre perdue + deux 7)", has("11/1", "7/7/1"), true);
t("lecture propre sans 1 : rien d'autre", confusionCandidates("8/3/2").map((c) => txt(c.kda)), ["8/3/2"]);

// ── Fourchette du score ───────────────────────────────────────────────────
t("score 974 -> kills 4..10", killsRange("974"), { min: 4, max: 10 });
t("score 124 (724 mal lu) garde 7 possible", (killsRange("124")?.max ?? 0) >= 7, true);
t("debris de score ignore", killsRange("23"), null);

// ── Recherche de la correction ────────────────────────────────────────────
// Match 4v4, 9 manches (5:4). Bleu : 8/7/1 7/7/0 7/7/0 3/6/0 ; rouge : 10/6/0
// 9/7/0 7/6/1 1/6/0. La 2e ligne bleue est lue "7/1/0", et une relecture de la
// 3e rend "7/13/0" : la combinaison naive retablit l'egalite en abimant la 3e.
const lim9: Limits = { ...LOOSE_LIMITS, maxDeaths: 9 };
const sides: Array<"blue" | "red"> = ["blue", "blue", "blue", "blue", "red", "red", "red", "red"];
const lus = ["8/7/1", "7/1/0", "7/7/0", "3/6/0", "10/6/0", "9/7/0", "7/6/1", "1/6/0"];
const rereads: Record<number, string[]> = { 2: ["7/13/0"] };
const rows: RowOptions[] = lus.map((raw, i) => ({
  side: sides[i],
  options: rowOptions(raw, k(raw), (rereads[i] ?? []).map(k), lim9),
}));
t("lecture brute desequilibree", balanced(rows.map((r) => ({ side: r.side, kda: r.options[0].kda }))), false);
const choice = searchCombination(rows, lim9);
const fixed = choice ? rows.map((r, i) => txt(r.options[choice[i]].kda)) : null;
t("seule la ligne fausse est corrigee", fixed, ["8/7/1", "7/7/0", "7/7/0", "3/6/0", "10/6/0", "9/7/0", "7/6/1", "1/6/0"]);

// Deux erreurs qui se compensent : "3/1/2" (3/7/2) et "11/1" (7/7/1). Sans le
// score, "1/7/1" retablit aussi l'egalite, plus vite. Le score lu (974) l'ecarte.
const lus2 = ["13/5/0", "8/6/0", "4/6/1", "3/1/2", "10/6/1", "11/1", "7/8/2", "0/7/0"];
const scores2 = ["1368", "917", "431", "414", "1071", "974", "752", "0"];
const rows2: RowOptions[] = lus2.map((raw, i) => ({
  side: sides[i],
  options: rowOptions(raw, k(raw.split("/").length === 3 ? raw : "11/1/?"), [], lim9, scores2[i]),
}));
const c2 = searchCombination(rows2, lim9);
t("deux erreurs, le score tranche", c2 ? rows2.map((r, i) => txt(r.options[c2[i]].kda)) : null,
  ["13/5/0", "8/6/0", "4/6/1", "3/7/2", "10/6/1", "7/7/1", "7/8/2", "0/7/0"]);

// Ecart sans aucune lecture suspecte (suicide, bombe) : on ne corrige rien.
const stables = ["5/2/0", "4/3/0", "3/3/0", "2/4/0", "3/4/0", "3/4/0", "2/4/0", "2/2/0"];
const rows3: RowOptions[] = stables.map((raw, i) => ({ side: sides[i], options: rowOptions(raw, k(raw), [], lim9) }));
t("ecart reel non corrige", searchCombination(rows3, lim9), null);

// ── Deduction d'une ligne seule ───────────────────────────────────────────
const base = lus.map((raw, i) => ({ side: sides[i], kda: k(i === 1 ? "?/?/0" : raw) }));
t("ligne deduite des autres", deduceRow(base, 1, lim9), { kills: 7, deaths: 7, assists: 0 });

console.log(`\n==== ${ok} ok, ${ko} echec(s) ====`);
process.exit(ko ? 1 : 0);
