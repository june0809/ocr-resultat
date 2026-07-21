import sharp from "sharp";
import { createWorker } from "tesseract.js";

/**
 * Banc de calibration headless : decoupe les cellules d'une vraie capture selon
 * le template et lance Tesseract case par case. Sert a valider les coordonnees
 * relatives et la qualite de lecture SANS navigateur. Usage :
 *   node scripts/ocr-calibrate.mjs examples/screens/codm-tdm-01.jpg
 */

// --- Template CODM S&D (miroir de lib/ocr/template.ts) ---
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

function cellRect(box, rowIndex, col, W, H) {
  const bx = box.x * W, by = box.y * H, bw = box.width * W, bh = box.height * H;
  return {
    left: Math.round(bx + col.x * bw),
    top: Math.round(by + (ROWS.top + rowIndex * ROWS.height) * bh),
    width: Math.round(col.width * bw),
    height: Math.round(ROWS.height * bh),
  };
}

const file = process.argv[2] ?? "examples/screens/codm-tdm-01.jpg";
const meta = await sharp(file).metadata();
const W = meta.width, H = meta.height;
console.log(`Image ${file} : ${W}x${H}\n`);

const worker = await createWorker("eng");

for (const table of TABLES) {
  console.log(`=== ${table.side.toUpperCase()} ===`);
  for (let row = 0; row < ROWS.count; row++) {
    const out = [];
    for (const col of COLUMNS) {
      const r = cellRect(table.box, row, col, W, H);
      // pretraitement : crop -> gris -> upscale x3 -> normalisation contraste
      const buf = await sharp(file)
        .extract(r)
        .grayscale()
        .resize({ width: r.width * 3, height: r.height * 3, fit: "fill" })
        .normalize()
        .toBuffer();
      await worker.setParameters({ tessedit_char_whitelist: WHITELIST[col.type] });
      const { data } = await worker.recognize(buf);
      const text = data.text.trim().replace(/\s+/g, col.type === "text" ? " " : "");
      out.push(`${col.field}="${text}" (${(data.confidence / 100).toFixed(2)})`);
    }
    console.log(`  row ${row}: ${out.join("  |  ")}`);
  }
  console.log("");
}

await worker.terminate();
