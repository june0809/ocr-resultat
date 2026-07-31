import { readFileSync } from "node:fs";
import { ocrImage } from "../lib/ocr/server/ingest";

/**
 * Banc e2e SERVEUR (§9, Lot A) : appelle directement le pipeline image
 * (detect -> anchor -> template -> Tesseract) sur les vraies captures, SANS
 * serveur ni reseau (traineddata vendoree). Verifie le comptage auto des
 * joueurs et la precision K/D/A contre la verite terrain. `npm run e2e`.
 */

interface Case {
  img: string;
  size: number; // joueurs/equipe attendus (verif du comptage auto)
  truth: string | null;
}

// Deux familles d'appareils VOLONTAIREMENT melangees : le scoreboard CODM ne se
// contente pas de se redimensionner, il REFOND sa mise en page selon le ratio de
// l'ecran. Un banc qui ne testerait qu'une famille validerait une calibration qui
// casse sur l'autre.
//   iPad      2420x1668 (ratio 1.45) : pseudo 23.6-37 %, score 50-57 %, K/D/A 65-73.5 %
//   telephone 1600x720  (ratio 2.22) : pseudo 18.6-26 %, score 44.9-49.5 %, K/D/A 61.8-68.5 %
const CASES: Case[] = [
  { img: "examples/screens/codm-tdm-01.jpg", size: 5, truth: "examples/web-codm-tdm.json" },
  { img: "examples/screens/codm-tdm-02.jpg", size: 5, truth: "examples/web-codm-tdm-02.json" },
  { img: "examples/screens/codm-tdm-03.jpg", size: 5, truth: "examples/web-codm-tdm-03.json" },
  { img: "examples/screens/codm-tel-01.png", size: 4, truth: "examples/web-codm-tel.json" },
];

/** Score de manches + vainqueur attendus, lus dans la verite terrain. Les fichiers
 *  examples/web-*.json portent deja `rounds_won` et `placement` par equipe : on
 *  s'en sert plutot que de recopier des constantes qui deriveraient. */
function expectedRounds(truth: {
  extracted: { teams: Array<{ rounds_won?: number; placement?: number }> };
}): { blue: number; red: number; winner: 1 | 2 } | null {
  const [blue, red] = truth.extracted.teams;
  if (blue?.rounds_won === undefined || red?.rounds_won === undefined) return null;
  return {
    blue: blue.rounds_won,
    red: red.rounds_won,
    winner: blue.placement === 1 ? 1 : 2,
  };
}

async function main(): Promise<void> {
  let gOk = 0;
  let gTot = 0;
  let rOk = 0;
  let rTot = 0;
  let failures = 0;

  for (const c of CASES) {
    const image = readFileSync(c.img);
    const t0 = Date.now();
    const res = await ocrImage(image, { game: "codm", screen: "codm_mp" });
    const ms = Date.now() - t0;

    if (!res.ok) {
      console.log(`\n#### ${c.img} — ECHEC : ${res.code} (${res.detail})`);
      failures++;
      continue;
    }

    const r = res.response;
    const players = r.teams.flatMap((t) => t.players);
    const expected = c.size * 2;
    const countOk = players.length === expected;
    if (!countOk) failures++;

    console.log(
      `\n#### ${c.img} — ${ms}ms — joueurs ${players.length}/${expected} ${countOk ? "OK" : "MISMATCH"} | conf=${r.confidence} | engine=${JSON.stringify(r.engine)} | warnings=${r.warnings.length}`
    );

    if (c.truth) {
      const truth = JSON.parse(readFileSync(c.truth, "utf8"));
      const gt = truth.extracted.teams.flatMap(
        (t: { players: Record<string, number>[] }) => t.players
      ) as Record<string, number>[];
      let ok = 0;
      let tot = 0;
      const n = Math.min(gt.length, players.length);
      for (let i = 0; i < n; i++) {
        const P = players[i] as unknown as Record<string, number | undefined>;
        for (const f of ["kills", "deaths", "assists"] as const) {
          tot++;
          if ((gt[i][f] ?? 0) === (P[f] ?? 0)) ok++;
        }
      }
      gOk += ok;
      gTot += tot;
      console.log(`  K/D/A vs verite : ${ok}/${tot} (${((ok / tot) * 100).toFixed(0)}%)`);

      // Score de manches : c'est lui qui designe le vainqueur en R&D. Une erreur
      // ici attribue la victoire a la mauvaise equipe — plus grave qu'un K/D/A
      // faux, d'ou son comptage a part et son echec dur.
      const exp = expectedRounds(truth);
      if (exp) {
        rTot++;
        const blue = r.teams[0];
        const red = r.teams[1];
        const got =
          blue?.rounds_won !== undefined && red?.rounds_won !== undefined
            ? { blue: blue.rounds_won, red: red.rounds_won, winner: blue.placement }
            : null;
        const match =
          got !== null &&
          got.blue === exp.blue &&
          got.red === exp.red &&
          got.winner === exp.winner;
        if (match) rOk++;
        else failures++;
        const shown = got ? `${got.blue}:${got.red} (gagnant equipe ${got.winner})` : "NON LU";
        console.log(
          `  Manches vs verite : ${shown} vs ${exp.blue}:${exp.red} (gagnant equipe ${exp.winner}) ${match ? "OK" : "MISMATCH"}`
        );
      }
    }

    for (const t of r.teams) {
      for (const p of t.players) {
        const pc = p.fields?.pseudo?.confidence ?? 0;
        console.log(
          `   ${p.is_mvp ? "*" : " "} ${String(p.kills)}/${String(p.deaths)}/${String(p.assists ?? "-")}  conf=${p.confidence}  pseudoConf=${pc}  "${p.pseudo}"`
        );
      }
    }
  }

  console.log(
    `\n==== K/D/A verite terrain : ${gOk}/${gTot} (${gTot ? ((gOk / gTot) * 100).toFixed(1) : "-"}%)` +
      ` | manches+vainqueur : ${rOk}/${rTot} | echecs: ${failures} ====`
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
