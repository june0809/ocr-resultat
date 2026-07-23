import { readFileSync } from "node:fs";
import { ocrImage } from "@/lib/ocr/server/ingest";

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

const CASES: Case[] = [
  { img: "examples/screens/codm-tdm-01.jpg", size: 5, truth: "examples/web-codm-tdm.json" },
  { img: "examples/screens/codm-tdm-02.jpg", size: 5, truth: "examples/web-codm-tdm-02.json" },
  { img: "examples/screens/codm-tdm-03.jpg", size: 5, truth: "examples/web-codm-tdm-03.json" },
  { img: "examples/screens/codm-tournoi-01.webp", size: 4, truth: null },
];

async function main(): Promise<void> {
  let gOk = 0;
  let gTot = 0;
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
    `\n==== K/D/A verite terrain : ${gOk}/${gTot} (${gTot ? ((gOk / gTot) * 100).toFixed(1) : "-"}%) | echecs: ${failures} ====`
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
