import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { readFileSync } from "node:fs";

/**
 * Test de bout en bout sur les vraies captures : OCR headless -> assemblage du
 * payload -> POST /v1/matches -> verif de la reponse + precision vs verite terrain.
 * Prerequis : serveur local lance avec API_KEYS. Usage : node scripts/ocr-e2e.mjs
 */

const BASE = "http://localhost:3000";
const KEY = "sk_d39H3u5uTxBs1OGrxxRCio7W3capk9Zn";

const COLUMNS = [
  { field: "pseudo", type: "text", x: 0.2, width: 0.28 },
  { field: "score", type: "int", x: 0.48, width: 0.16 },
  { field: "ema", type: "ema", x: 0.65, width: 0.18 },
];
const ROWS = { top: 0.0, height: 0.2, count: 5 };
const TABLES = [
  { side: "blue", box: { x: 0.015, y: 0.273, width: 0.465, height: 0.417 } },
  { side: "red", box: { x: 0.505, y: 0.273, width: 0.465, height: 0.417 } },
];
const WHITELIST = { text: "", int: "0123456789", ema: "0123456789/" };

// capture -> [manches gauche, manches droite] + fichier verite terrain
const CASES = [
  { img: "examples/screens/codm-tdm-01.jpg", rounds: [5, 4], truth: "examples/web-codm-tdm.json" },
  { img: "examples/screens/codm-tdm-02.jpg", rounds: [3, 5], truth: "examples/web-codm-tdm-02.json" },
  { img: "examples/screens/codm-tdm-03.jpg", rounds: [0, 5], truth: "examples/web-codm-tdm-03.json" },
];

function cellRect(box, row, col, W, H) {
  const bx = box.x * W, by = box.y * H, bw = box.width * W, bh = box.height * H;
  return {
    left: Math.round(bx + col.x * bw),
    top: Math.round(by + (ROWS.top + row * ROWS.height) * bh),
    width: Math.round(col.width * bw),
    height: Math.round(ROWS.height * bh),
  };
}
const parseEma = (raw) => { const n = (raw.match(/\d+/g) || []).map((x) => parseInt(x, 10)); return { kills: n[0] ?? null, deaths: n[1] ?? null, assists: n[2] ?? null }; };
const parseInt0 = (raw) => { const m = raw.match(/\d+/); return m ? parseInt(m[0], 10) : null; };

async function ocrImage(worker, file) {
  const { width: W, height: H } = await sharp(file).metadata();
  const teams = [];
  for (const table of TABLES) {
    const players = [];
    for (let row = 0; row < ROWS.count; row++) {
      const by = {};
      for (const col of COLUMNS) {
        const r = cellRect(table.box, row, col, W, H);
        const buf = await sharp(file).extract(r).grayscale().resize({ width: r.width * 3, height: r.height * 3, fit: "fill" }).normalize().toBuffer();
        await worker.setParameters({ tessedit_char_whitelist: WHITELIST[col.type] });
        const { data } = await worker.recognize(buf);
        by[col.field] = { text: data.text.trim().replace(/\s+/g, col.type === "text" ? " " : ""), conf: data.confidence / 100 };
      }
      const ema = parseEma(by.ema.text);
      players.push({
        pseudo: by.pseudo.text,
        kills: ema.kills ?? 0, deaths: ema.deaths ?? 0, assists: ema.assists ?? 0,
        score: parseInt0(by.score.text),
        confidence: by.ema.conf,
        pseudo_confidence: by.pseudo.conf,
      });
    }
    teams.push({ side: table.side, players });
  }
  return teams;
}

function buildBody(teams, rounds) {
  const [bl, rd] = rounds;
  const place = (side) => (side === "blue" ? (bl >= rd ? 1 : 2) : (bl >= rd ? 2 : 1));
  const mk = (t) => {
    const max = Math.max(...t.players.map((p) => p.score ?? -1));
    return {
      placement: place(t.side),
      rounds_won: t.side === "blue" ? bl : rd,
      players: t.players.map((p) => ({
        pseudo: p.pseudo, kills: p.kills, deaths: p.deaths, assists: p.assists,
        is_mvp: p.score !== null && p.score === max,
        confidence: Math.max(0.01, Math.min(1, p.confidence)),
        pseudo_confidence: Math.max(0, Math.min(1, p.pseudo_confidence)),
      })),
    };
  };
  return { source: "web", game: "codm", mode: "team_deathmatch", extracted: { teams: teams.map(mk) } };
}

function emaAccuracy(teams, truthFile) {
  const truth = JSON.parse(readFileSync(truthFile, "utf8"));
  const flat = (arr) => arr.flatMap((t) => t.players);
  const gt = flat(truth.extracted.teams);
  const got = teams.flatMap((t) => t.players);
  let ok = 0, tot = 0;
  for (let i = 0; i < Math.min(gt.length, got.length); i++) {
    for (const f of ["kills", "deaths", "assists"]) {
      tot++;
      if ((gt[i][f] ?? 0) === got[i][f]) ok++;
    }
  }
  return { ok, tot };
}

const worker = await createWorker("eng");
let grandOk = 0, grandTot = 0;
for (const c of CASES) {
  console.log(`\n######## ${c.img} (manches ${c.rounds[0]}:${c.rounds[1]}) ########`);
  const teams = await ocrImage(worker, c.img);
  const acc = emaAccuracy(teams, c.truth);
  grandOk += acc.ok; grandTot += acc.tot;
  const body = buildBody(teams, c.rounds);

  const resp = await fetch(`${BASE}/v1/matches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json();

  console.log(`  precision É/M/A vs verite terrain : ${acc.ok}/${acc.tot}`);
  console.log(`  HTTP ${resp.status}  match_id=${json.match_id ?? "-"}  confidence=${json.confidence ?? "-"}`);
  const winner = json.teams?.find((t) => t.placement === 1);
  console.log(`  gagnant (placement 1) : equipe ${winner === json.teams?.[0] ? "gauche/bleue" : "droite/rouge"}  rounds_won=${winner?.rounds_won}`);
  const mvps = json.teams?.flatMap((t) => t.players).filter((p) => p.is_mvp).map((p) => p.pseudo);
  console.log(`  MVP detectes : ${mvps?.join(", ")}`);
  console.log(`  warnings basse confiance : ${json.warnings?.length ?? 0}`);
}
await worker.terminate();
console.log(`\n==== PRECISION GLOBALE É/M/A : ${grandOk}/${grandTot} (${((grandOk / grandTot) * 100).toFixed(1)}%) ====`);
