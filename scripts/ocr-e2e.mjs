import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { readFileSync } from "node:fs";

/**
 * Test e2e : auto-detection (barres d'en-tete + bas) -> OCR -> POST /v1/matches.
 * Prerequis : serveur local avec API_KEYS. Usage : node scripts/ocr-e2e.mjs
 */
const BASE = "http://localhost:3000";
const KEY = "sk_d39H3u5uTxBs1OGrxxRCio7W3capk9Zn";

const COLUMNS = [
  { field: "pseudo", type: "text", x: 0.16, width: 0.2 },
  { field: "score", type: "int", x: 0.4, width: 0.11 },
  { field: "ema", type: "ema", x: 0.58, width: 0.17 },
];
const MVP_BADGE = { x: 0.33, width: 0.12 };
const WL = { text: "", int: "0123456789", ema: "0123456789/" };

const CASES = [
  { img: "examples/screens/codm-tdm-01.jpg", size: 5, rounds: [5, 4], truth: "examples/web-codm-tdm.json" },
  { img: "examples/screens/codm-tdm-02.jpg", size: 5, rounds: [3, 5], truth: "examples/web-codm-tdm-02.json" },
  { img: "examples/screens/codm-tdm-03.jpg", size: 5, rounds: [0, 5], truth: "examples/web-codm-tdm-03.json" },
  { img: "examples/screens/codm-tournoi-01.webp", size: 4, rounds: [2, 5], truth: null },
];

const isBlue = (r, g, b) => b > 110 && b - r > 25 && b - g > 5 && r < 140;
const isRed = (r, g, b) => r > 110 && r - b > 30 && r - g > 30 && b < 130;
const isGold = (r, g, b) => r > 150 && g > 115 && b < 110 && r - b > 55 && g - b > 35;
const isSilver = (r, g, b) => r > 120 && g > 130 && b > 140 && Math.max(r, g, b) - Math.min(r, g, b) < 45 && b >= r;

async function detect(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const at = (x, y) => { const i = (y * W + x) * C; return [data[i], data[i + 1], data[i + 2]]; };
  const half = Math.floor(W / 2);
  let hTop = -1, hBot = -1;
  for (let y = 0; y < H; y++) {
    let bl = 0, rd = 0;
    for (let x = 0; x < half; x++) if (isBlue(...at(x, y))) bl++;
    for (let x = half; x < W; x++) if (isRed(...at(x, y))) rd++;
    if (bl / half > 0.5 && rd / half > 0.4) { if (hTop < 0) hTop = y; hBot = y; }
  }
  const my = Math.floor((hTop + hBot) / 2);
  let bxMin = W, bxMax = 0, rxMin = W, rxMax = 0;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = at(x, my);
    if (isBlue(r, g, b)) { bxMin = Math.min(bxMin, x); bxMax = Math.max(bxMax, x); }
    if (isRed(r, g, b)) { rxMin = Math.min(rxMin, x); rxMax = Math.max(rxMax, x); }
  }
  const bright = (x, y) => { const [r, g, b] = at(x, y); return (r + g + b) / 3 > 95; };
  const bandH = Math.max(2, Math.round(H * 0.01));
  let bottom = hBot, gap = 0;
  for (let y = hBot + bandH; y < H * 0.9; y += bandH) {
    let c = 0;
    for (let x = bxMin; x < bxMax; x++) if (bright(x, y)) c++;
    if (c / Math.max(1, bxMax - bxMin) > 0.03) { bottom = y; gap = 0; }
    else { gap += bandH; if (gap > H * 0.05) break; }
  }
  const boxOf = (xa, xb) => ({ x: xa, y: hBot, w: xb - xa, h: bottom - hBot });
  return { W, H, C, data, blue: boxOf(bxMin, bxMax), red: boxOf(rxMin, rxMax) };
}

function badgeScore(det, box, top, rowH) {
  const { data, W, C } = det;
  const left = Math.round(box.x + MVP_BADGE.x * box.w), width = Math.round(MVP_BADGE.width * box.w);
  let hit = 0, tot = 0;
  for (let y = Math.round(top); y < Math.round(top + rowH); y++)
    for (let x = left; x < left + width; x++) {
      const i = (y * W + x) * C, r = data[i], g = data[i + 1], b = data[i + 2];
      tot++; if (isGold(r, g, b) || isSilver(r, g, b)) hit++;
    }
  return hit / Math.max(1, tot);
}

const parseEma = (raw) => { const n = (raw.match(/\d+/g) || []).map((x) => parseInt(x, 10)); return { kills: n[0] ?? 0, deaths: n[1] ?? 0, assists: n[2] ?? 0 }; };
const parseInt0 = (raw) => { const m = raw.match(/\d+/); return m ? parseInt(m[0], 10) : null; };

async function ocrTeam(worker, file, det, box, size) {
  const rowH = box.h / size;
  const players = [];
  for (let r = 0; r < size; r++) {
    const top = box.y + r * rowH, by = {};
    for (const col of COLUMNS) {
      const rect = { left: Math.round(box.x + col.x * box.w), top: Math.round(top), width: Math.round(col.width * box.w), height: Math.round(rowH) };
      const buf = await sharp(file).extract(rect).grayscale().resize({ width: rect.width * 3, height: rect.height * 3, fit: "fill" }).normalize().toBuffer();
      await worker.setParameters({ tessedit_char_whitelist: WL[col.type] });
      const { data: d } = await worker.recognize(buf);
      by[col.field] = { text: d.text.trim().replace(/\s+/g, col.type === "text" ? " " : ""), conf: d.confidence / 100 };
    }
    const ema = parseEma(by.ema.text);
    players.push({ pseudo: by.pseudo.text, ...ema, score: parseInt0(by.score.text), is_mvp: r === 0, confidence: by.ema.conf, pseudo_confidence: by.pseudo.conf });
  }
  return players;
}

function emaAcc(teams, truthFile) {
  if (!truthFile) return null;
  const truth = JSON.parse(readFileSync(truthFile, "utf8"));
  const gt = truth.extracted.teams.flatMap((t) => t.players);
  const got = teams.flatMap((t) => t.players);
  let ok = 0, tot = 0;
  for (let i = 0; i < Math.min(gt.length, got.length); i++) for (const f of ["kills", "deaths", "assists"]) { tot++; if ((gt[i][f] ?? 0) === got[i][f]) ok++; }
  return { ok, tot };
}

const worker = await createWorker("eng");
let gOk = 0, gTot = 0;
for (const c of CASES) {
  console.log(`\n######## ${c.img} (${c.size}v${c.size}, manches ${c.rounds[0]}:${c.rounds[1]}) ########`);
  const det = await detect(c.img);
  const bluePlayers = await ocrTeam(worker, c.img, det, det.blue, c.size);
  const redPlayers = await ocrTeam(worker, c.img, det, det.red, c.size);
  const teams = [{ side: "blue", players: bluePlayers }, { side: "red", players: redPlayers }];
  const acc = emaAcc(teams, c.truth);
  if (acc) { gOk += acc.ok; gTot += acc.tot; }

  const [bl, rd] = c.rounds;
  const mk = (players, side) => ({
    placement: side === "blue" ? (bl >= rd ? 1 : 2) : (bl >= rd ? 2 : 1),
    rounds_won: side === "blue" ? bl : rd,
    players: players.map((p) => ({ pseudo: p.pseudo || "?", kills: p.kills, deaths: p.deaths, assists: p.assists, is_mvp: p.is_mvp, confidence: Math.max(0.01, Math.min(1, p.confidence)), pseudo_confidence: Math.max(0, Math.min(1, p.pseudo_confidence)) })),
  });
  const body = { source: "web", game: "codm", mode: "team_deathmatch", extracted: { teams: [mk(bluePlayers, "blue"), mk(redPlayers, "red")] } };
  const resp = await fetch(`${BASE}/v1/matches`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
  const json = await resp.json();
  console.log(`  precision É/M/A : ${acc ? acc.ok + "/" + acc.tot : "(pas de verite terrain)"}`);
  console.log(`  HTTP ${resp.status}  confidence=${json.confidence ?? "-"}  players=${c.size * 2}`);
  const mvps = json.teams?.flatMap((t) => t.players).filter((p) => p.is_mvp).map((p) => p.pseudo);
  console.log(`  MVP: ${mvps?.join(" | ")}   warnings=${json.warnings?.length ?? 0}`);
  for (const t of [["blue", bluePlayers], ["red", redPlayers]])
    for (const p of t[1]) console.log(`    ${t[0]} score=${String(p.score).padStart(4)} ema=${p.kills}/${p.deaths}/${p.assists}  pseudo="${p.pseudo}"`);
}
await worker.terminate();
console.log(`\n==== É/M/A verite terrain : ${gOk}/${gTot} (${((gOk / gTot) * 100).toFixed(1)}%) ====`);
