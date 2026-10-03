/**
 * CONTROLE DE COHERENCE DES E/M/A — fonctions pures, sans tesseract.
 *
 * Le constat qui fonde ce module : dans un match a deux equipes, chaque
 * elimination d'un joueur est la mort d'un adversaire. Donc
 *
 *     somme des kills de l'equipe bleue  ==  somme des morts de l'equipe rouge
 *     somme des kills de l'equipe rouge  ==  somme des morts de l'equipe bleue
 *
 * Mesure le 03/10 sur 25 captures reelles de tournoi (Recherche & Destruction) :
 * l'egalite tient sur 24. La seule exception est un 3 contre 4 (un joueur parti
 * en cours de partie : ses morts et ses kills ne sont plus affiches).
 *
 * Deuxieme garde-fou, propre a la Recherche & Destruction : on ne meurt qu'une
 * fois par manche. Un joueur ne peut donc pas avoir plus de morts que de
 * manches jouees (5:4 -> 9 manches -> 9 morts au plus). "7/71/1" ou "2/17/1"
 * sont des lectures impossibles, quel que soit le reste du tableau.
 *
 * Pourquoi c'est precieux : Tesseract confond le 7 de la police CODM avec un 1.
 * Erreurs relevees sur les vraies captures : "7/7/1" lu "11/1", "2/7/1" lu
 * "2/17/1", "7/7/1" lu "7/71/1", "3/7/2" lu "3/1/2", "7/7/0" lu "7/1/0". Une
 * lecture fausse casse presque toujours l'egalite, ce qui la DETECTE ; parmi
 * les relectures et les erreurs connues, la moins couteuse qui la retablit la
 * CORRIGE.
 *
 * Ce qu'on s'interdit : corriger une lecture bien formee pour en faire une
 * autre qui n'est ni relue par une autre passe, ni explicable par une erreur
 * connue. Un suicide ou une mort par la bombe n'a pas de tueur et casse
 * l'egalite sans aucune faute de lecture : dans ce cas, aucune correction
 * plausible n'existe et on se contente de signaler l'ecart.
 */

export interface Kda {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
}

/** Une option de lecture pour une ligne, avec son cout (0 = lecture d'origine). */
export interface KdaOption {
  kda: Kda;
  cost: number;
}

export interface RowOptions {
  side: "blue" | "red";
  /** options[0] = la lecture d'origine (cout 0, eventuellement invalide). */
  options: KdaOption[];
}

export type EmaCheck = "ok" | "corrige" | "deduit" | "douteux";

/** Bornes de vraisemblance. maxDeaths = manches jouees en Recherche &
 *  Destruction (score de manches lu), sinon une borne large. */
export interface Limits {
  maxDeaths: number;
  maxKills: number;
}
export const LOOSE_LIMITS: Limits = { maxDeaths: 60, maxKills: 60 };

const KDA_STRICT = /^(\d{1,2})\/(\d{1,2})\/(\d{1,2})$/;

export function isValid(k: Kda, lim: Limits): boolean {
  return (
    k.kills !== null && k.deaths !== null && k.assists !== null &&
    k.kills <= lim.maxKills && k.deaths <= lim.maxDeaths && k.assists <= lim.maxKills
  );
}

/** L'egalite kills/morts, sur des lignes deja choisies. null si une valeur manque. */
export function balanced(rows: Array<{ side: "blue" | "red"; kda: Kda }>): boolean | null {
  const g = gaps(rows);
  return g === null ? null : g.blue === 0 && g.red === 0;
}

/** Ecart (pour l'affichage) : kills bleus - morts rouges, kills rouges - morts bleues. */
export function gaps(rows: Array<{ side: "blue" | "red"; kda: Kda }>): { blue: number; red: number } | null {
  let kb = 0, db = 0, kr = 0, dr = 0;
  for (const r of rows) {
    if (r.kda.kills === null || r.kda.deaths === null) return null;
    if (r.side === "blue") { kb += r.kda.kills; db += r.kda.deaths; }
    else { kr += r.kda.kills; dr += r.kda.deaths; }
  }
  return { blue: kb - dr, red: kr - db };
}

/**
 * Lectures plausibles d'une cellule E/M/A brute, d'apres les erreurs CONNUES
 * de Tesseract sur la police CODM. Chaque edition coute 1 :
 *   - un "1" qui etait un "7"                    ("7/1/0"  -> "7/7/0")
 *   - un "1" parasite colle a un 7 ou a un "/"   ("2/17/1" -> "2/7/1")
 *   - une barre "/" perdue entre deux chiffres   ("11/1"   -> "1/1/1")
 * Ne rend que des triplets bien formes, au plus `maxEdits` editions.
 */
export function confusionCandidates(raw: string, maxEdits = 3): KdaOption[] {
  const start = raw.replace(/[^0-9/]/g, "");
  const best = new Map<string, number>();
  let frontier = new Map<string, number>([[start, 0]]);
  const seen = new Set<string>([start]);
  for (let e = 0; e <= maxEdits; e++) {
    for (const [s] of frontier) {
      const m = s.match(KDA_STRICT);
      if (m && !best.has(s)) best.set(s, e);
    }
    if (e === maxEdits) break;
    const next = new Map<string, number>();
    for (const [s] of frontier) {
      for (let i = 0; i < s.length; i++) {
        const out: string[] = [];
        if (s[i] === "1") {
          out.push(s.slice(0, i) + "7" + s.slice(i + 1));
          const prev = s[i - 1], nxt = s[i + 1];
          if (prev === "7" || prev === "/" || nxt === "7" || nxt === "/") out.push(s.slice(0, i) + s.slice(i + 1));
        }
        if (i > 0 && /\d/.test(s[i - 1]) && /\d/.test(s[i])) out.push(s.slice(0, i) + "/" + s.slice(i));
        for (const o of out) if (o && !seen.has(o)) { seen.add(o); next.set(o, e + 1); }
      }
    }
    frontier = next;
  }
  return [...best.entries()].map(([s, cost]) => {
    const m = s.match(KDA_STRICT)!;
    return { kda: { kills: +m[1], deaths: +m[2], assists: +m[3] }, cost };
  });
}

/**
 * Fourchette de kills compatible avec le SCORE lu sur la meme ligne.
 *
 * Mesure le 03/10 sur 199 lignes reelles : score >= 100 x kills, toujours, et
 * l'excedent (assists, pose et desamorcage) n'a jamais depasse ~400. Mais le
 * score souffre lui aussi de la confusion 7 -> 1 ("724" lu "124") : la borne
 * haute se calcule donc avec tous les 1 remplaces par des 7, et la fourchette
 * garde une marge. Un score de moins de 3 chiffres ou demesure est un debris de
 * lecture ("23" pour 1023) : on ne s'en sert pas.
 */
export function killsRange(scoreRaw: string): { min: number; max: number } | null {
  const digits = scoreRaw.replace(/\D/g, "");
  if (digits.length < 3) return null;
  const low = parseInt(digits, 10);
  const high = parseInt(digits.replace(/1/g, "7"), 10);
  if (low > 2500) return null;
  return { min: Math.max(0, Math.ceil((low - 500) / 100) - 1), max: Math.floor(high / 100) + 1 };
}

/** Penalite d'une option dont les kills sortent de la fourchette du score. */
const SCORE_PENALTY = 3;

/**
 * Options d'une ligne : la lecture d'origine, les relectures d'autres passes
 * (cout 1,5 : un autre pretraitement les a vues), les erreurs connues (cout =
 * nombre d'editions). Une option vue par les deux voies coute moins ; une
 * option dont les kills contredisent le score lu coute plus. Les options
 * invalides (morts > manches, triplet incomplet) sont ecartees, sauf la
 * lecture d'origine qui reste en tete pour la tracabilite.
 */
export function rowOptions(rawMain: string, main: Kda, rereads: Kda[], lim: Limits, scoreRaw = ""): KdaOption[] {
  const key = (k: Kda) => `${k.kills}/${k.deaths}/${k.assists}`;
  const range = killsRange(scoreRaw);
  const penalty = (k: Kda) =>
    range && k.kills !== null && (k.kills < range.min || k.kills > range.max) ? SCORE_PENALTY : 0;
  const map = new Map<string, KdaOption>();
  const add = (kda: Kda, cost: number) => {
    if (!isValid(kda, lim)) return;
    const e = map.get(key(kda));
    if (!e) map.set(key(kda), { kda, cost });
    else e.cost = Math.max(0, Math.min(e.cost, cost) - 0.5); // deux sources concordent
  };
  for (const c of confusionCandidates(rawMain)) if (c.cost > 0) add(c.kda, c.cost);
  for (const r of rereads) if (key(r) !== key(main)) add(r, 1.5);
  const others = [...map.values()]
    .filter((o) => key(o.kda) !== key(main))
    .map((o) => ({ kda: o.kda, cost: o.cost + penalty(o.kda) }))
    .sort((a, b) => a.cost - b.cost);
  return [{ kda: main, cost: penalty(main) }, ...others];
}

function* combinations(n: number, k: number, start = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) { yield acc; return; }
  for (let i = start; i < n; i++) yield* combinations(n, k, i + 1, [...acc, i]);
}

/**
 * Cherche le choix d'options qui retablit l'egalite au MOINDRE cout. Une ligne
 * dont la lecture d'origine est invalide DOIT changer. Au plus `maxChanges`
 * lignes changent, et le cout total reste borne : au-dela, ce n'est plus une
 * correction, c'est une invention.
 *
 * @returns l'indice d'option retenu pour chaque ligne, ou null.
 */
export function searchCombination(rows: RowOptions[], lim: Limits, maxChanges = 4, maxCost = 6): number[] | null {
  const n = rows.length;
  const mustChange = rows.map((r) => !isValid(r.options[0].kda, lim));
  const pick = (choice: number[]) => rows.map((r, i) => ({ side: r.side, kda: r.options[choice[i]].kda }));
  const base = rows.map(() => 0);
  if (!mustChange.some(Boolean) && balanced(pick(base)) === true) return base;

  // Cout d'une solution = somme des couts des options retenues, lignes
  // inchangees comprises (une lecture d'origine qui contredit son score coute
  // deja quelque chose). Le plafond, lui, ne porte que sur les lignes changees.
  let best: { choice: number[]; cost: number; changes: number } | null = null;
  for (let k = 1; k <= Math.min(maxChanges, n); k++) {
    for (const idx of combinations(n, k)) {
      if (mustChange.some((m, i) => m && !idx.includes(i))) continue;
      if (idx.some((i) => rows[i].options.length < 2)) continue;
      const walk = (d: number, choice: number[], changedCost: number) => {
        if (changedCost > maxCost) return;
        if (d === idx.length) {
          if (balanced(pick(choice)) !== true) return;
          const total = rows.reduce((s, r, i) => s + r.options[choice[i]].cost, 0);
          if (!best || total < best.cost || (total === best.cost && k < best.changes))
            best = { choice: [...choice], cost: total, changes: k };
          return;
        }
        const i = idx[d];
        for (let j = 1; j < rows[i].options.length; j++) {
          choice[i] = j;
          walk(d + 1, choice, changedCost + rows[i].options[j].cost);
        }
        choice[i] = 0;
      };
      walk(0, [...base], 0);
    }
  }
  return best ? (best as { choice: number[] }).choice : null;
}

/**
 * Dernier recours : UNE seule ligne invalide, et aucune option ne retablit
 * l'egalite. Ses kills et ses morts se DEDUISENT alors des autres lignes. Les
 * assists, que l'egalite ne contraint pas, gardent la lecture d'origine.
 *
 * @returns le triplet deduit, ou null si la deduction est impossible ou
 *          invraisemblable.
 */
export function deduceRow(rows: Array<{ side: "blue" | "red"; kda: Kda }>, index: number, lim: Limits): Kda | null {
  const me = rows[index];
  let othersKillsSame = 0, othersDeathsSame = 0, killsOther = 0, deathsOther = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i === index) continue;
    const r = rows[i];
    if (r.kda.kills === null || r.kda.deaths === null) return null;
    if (r.side === me.side) { othersKillsSame += r.kda.kills; othersDeathsSame += r.kda.deaths; }
    else { killsOther += r.kda.kills; deathsOther += r.kda.deaths; }
  }
  const kills = deathsOther - othersKillsSame;
  const deaths = killsOther - othersDeathsSame;
  if (kills < 0 || deaths < 0 || kills > lim.maxKills || deaths > lim.maxDeaths) return null;
  return { kills, deaths, assists: me.kda.assists };
}
