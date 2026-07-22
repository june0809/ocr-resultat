"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CODM_SND, SND_COLUMNS, codmSndTables, type GameTemplate } from "@/lib/ocr/template";
import { autoDetectTables } from "@/lib/ocr/detect";
import { runOcr, type OcrResult } from "@/lib/ocr/pipeline";

/**
 * Page d'upload — Lot 2 (SPEC §5, §9). Chemin navigateur : l'OCR tourne cote
 * client (Tesseract.js/WASM), l'image ne quitte pas l'appareil, seul le JSON
 * structure est envoye a POST /v1/matches. Flux :
 *   1. charger une capture CODM Recherche & Destruction
 *   2. aligner la grille (2 tableaux) sur la capture
 *   3. saisir le score de manches (source de verite du placement)
 *   4. lancer l'OCR
 *   5. corriger le tableau pre-rempli (cases douteuses surlignees) puis envoyer
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Row {
  pseudo: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number | null;
  is_mvp: boolean;
  confidence: number;
  pseudo_confidence: number;
}

const LOW_CONF = 0.75; // seuil de surbrillance (§5.3)

export default function UploadPage() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [blueBox, setBlueBox] = useState<Box>(CODM_SND.tables[0].box);
  const [redBox, setRedBox] = useState<Box>(CODM_SND.tables[1].box);
  const [teamSize, setTeamSize] = useState<number>(4);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  const [blueRounds, setBlueRounds] = useState<number>(0);
  const [redRounds, setRedRounds] = useState<number>(0);

  const [blue, setBlue] = useState<Row[]>([]);
  const [red, setRed] = useState<Row[]>([]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [sendResult, setSendResult] = useState<string | null>(null);

  const onFile = useCallback((file: File) => {
    setImgUrl(URL.createObjectURL(file));
    setBlue([]);
    setRed([]);
    setSendResult(null);
  }, []);

  const template: GameTemplate = useMemo(
    () => ({
      game: "codm",
      mode: "team_deathmatch",
      tables: codmSndTables(blueBox, redBox, teamSize),
    }),
    [blueBox, redBox, teamSize]
  );

  // Auto-detection des tableaux au chargement de l'image (barres d'en-tete).
  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const det = autoDetectTables(img, img.naturalWidth, img.naturalHeight);
    if (det) {
      setBlueBox(det.blue);
      setRedBox(det.red);
      setDetectMsg("Tableaux détectés automatiquement. Ajustez si besoin.");
    } else {
      setDetectMsg("Détection auto impossible : alignez la grille à la main.");
    }
  }, []);

  const toRows = useCallback((res: OcrResult, side: "blue" | "red"): Row[] => {
    const team = res.teams.find((t) => t.side === side);
    if (!team) return [];
    return team.players.map((p) => ({
      pseudo: p.pseudo,
      kills: p.kills ?? 0,
      deaths: p.deaths ?? 0,
      assists: p.assists ?? 0,
      score: p.score,
      // MVP detecte par le badge dore/argente (fiable). Corrigible a la main.
      is_mvp: p.is_mvp,
      confidence: p.confidence,
      pseudo_confidence: p.pseudo_confidence,
    }));
  }, []);

  const launchOcr = useCallback(async () => {
    const img = imgRef.current;
    if (!img) return;
    setBusy(true);
    setProgress({ done: 0, total: 1 });
    setSendResult(null);
    try {
      const res = await runOcr(
        img,
        img.naturalWidth,
        img.naturalHeight,
        template,
        (done, total) => setProgress({ done, total })
      );
      setBlue(toRows(res, "blue"));
      setRed(toRows(res, "red"));
    } catch (e) {
      setSendResult("Erreur OCR : " + (e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [template, toRows]);

  const buildBody = useCallback(() => {
    const bluePlacement = blueRounds >= redRounds ? 1 : 2;
    const redPlacement = bluePlacement === 1 ? 2 : 1;
    const toPlayers = (rows: Row[]) =>
      rows.map((r) => ({
        pseudo: r.pseudo,
        kills: r.kills,
        deaths: r.deaths,
        assists: r.assists,
        is_mvp: r.is_mvp,
        confidence: r.confidence,
        pseudo_confidence: r.pseudo_confidence,
      }));
    return {
      source: "web" as const,
      game: "codm",
      mode: "team_deathmatch" as const,
      extracted: {
        teams: [
          { placement: bluePlacement, rounds_won: blueRounds, players: toPlayers(blue) },
          { placement: redPlacement, rounds_won: redRounds, players: toPlayers(red) },
        ],
      },
    };
  }, [blue, red, blueRounds, redRounds]);

  const send = useCallback(async () => {
    setBusy(true);
    setSendResult(null);
    try {
      const resp = await fetch("/v1/matches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildBody()),
      });
      const json = await resp.json();
      setSendResult(`HTTP ${resp.status}\n` + JSON.stringify(json, null, 2));
    } catch (e) {
      setSendResult("Erreur envoi : " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [apiKey, buildBody]);

  return (
    <main style={S.main}>
      <h1>Upload capture — CODM Recherche &amp; Destruction</h1>
      <p style={{ color: "#666" }}>
        L&apos;OCR tourne dans votre navigateur ; la capture ne quitte pas votre appareil.
      </p>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />

      {imgUrl && (
        <>
          <section style={S.section}>
            <h2>1. Nombre de joueurs par équipe</h2>
            <p style={S.hint}>
              4 en tournoi, 5 en classé. La grille s&apos;ajuste en conséquence.
            </p>
            {[4, 5].map((n) => (
              <label key={n} style={{ marginRight: 16 }}>
                <input type="radio" name="teamSize" checked={teamSize === n} onChange={() => setTeamSize(n)} /> {n}v{n}
              </label>
            ))}
          </section>

          <section style={S.section}>
            <h2>2. Aligner la grille</h2>
            <p style={S.hint}>
              {detectMsg ?? "Chargez une capture."} Déplacez chaque tableau (glisser) et
              ajustez le coin bas-droit sur les {teamSize} lignes. Bleu = gauche, rouge = droite.
            </p>
            <div ref={containerRef} style={S.imgWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imgUrl}
                alt="capture"
                onLoad={onImgLoad}
                style={{ width: "100%", display: "block" }}
              />
              <AlignBox box={blueBox} onChange={setBlueBox} color="#3b82f6" containerRef={containerRef} count={teamSize} />
              <AlignBox box={redBox} onChange={setRedBox} color="#ef4444" containerRef={containerRef} count={teamSize} />
            </div>
          </section>

          <section style={S.section}>
            <h2>3. Score de manches</h2>
            <p style={S.hint}>
              Le score en haut à gauche (bleu:rouge). C&apos;est lui qui décide du
              placement — pas le mot VICTOIRE/DÉFAITE.
            </p>
            <label>
              Bleu&nbsp;
              <input type="number" min={0} value={blueRounds} onChange={(e) => setBlueRounds(+e.target.value)} style={S.num} />
            </label>
            &nbsp;:&nbsp;
            <label>
              <input type="number" min={0} value={redRounds} onChange={(e) => setRedRounds(+e.target.value)} style={S.num} />
              &nbsp;Rouge
            </label>
            <span style={{ marginLeft: 12, color: "#666" }}>
              → gagnant : {blueRounds >= redRounds ? "Bleu (placement 1)" : "Rouge (placement 1)"}
            </span>
          </section>

          <section style={S.section}>
            <h2>4. Lancer l&apos;OCR</h2>
            <button onClick={launchOcr} disabled={busy} style={S.btn}>
              {busy && progress ? `OCR… ${progress.done}/${progress.total}` : "Lancer l'OCR"}
            </button>
          </section>
        </>
      )}

      {(blue.length > 0 || red.length > 0) && (
        <section style={S.section}>
          <h2>5. Vérifier &amp; corriger</h2>
          <p style={S.hint}>
            Les cases surlignées sont en basse confiance. Corrigez puis envoyez.
          </p>
          <TeamTable title="Équipe bleue (gauche)" rows={blue} setRows={setBlue} />
          <TeamTable title="Équipe rouge (droite)" rows={red} setRows={setRed} />

          <section style={S.section}>
            <h2>6. Envoyer</h2>
            <label>
              Clé d&apos;API&nbsp;
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk_…"
                style={{ ...S.num, width: 320 }}
              />
            </label>
            <button onClick={send} disabled={busy || !apiKey} style={{ ...S.btn, marginLeft: 12 }}>
              Envoyer à /v1/matches
            </button>
            {sendResult && <pre style={S.result}>{sendResult}</pre>}
          </section>
        </section>
      )}
    </main>
  );
}

/** Boite d'alignement draggable (déplacement + resize coin bas-droit) + guides. */
function AlignBox({
  box,
  onChange,
  color,
  containerRef,
  count,
}: {
  box: Box;
  onChange: (b: Box) => void;
  color: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  count: number;
}) {
  const startDrag = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...box };

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      if (mode === "move") {
        onChange({
          ...start,
          x: clamp(start.x + dx, 0, 1 - start.width),
          y: clamp(start.y + dy, 0, 1 - start.height),
        });
      } else {
        onChange({
          ...start,
          width: clamp(start.width + dx, 0.05, 1 - start.x),
          height: clamp(start.height + dy, 0.05, 1 - start.y),
        });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const pct = (n: number) => `${n * 100}%`;

  return (
    <div
      onPointerDown={startDrag("move")}
      style={{
        position: "absolute",
        left: pct(box.x),
        top: pct(box.y),
        width: pct(box.width),
        height: pct(box.height),
        border: `2px solid ${color}`,
        boxSizing: "border-box",
        cursor: "move",
        background: `${color}18`,
      }}
    >
      {/* guides : lignes (= count joueurs) */}
      {Array.from({ length: count - 1 }, (_, k) => k + 1).map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: pct(i / count),
            borderTop: `1px dashed ${color}80`,
          }}
        />
      ))}
      {/* guides : bornes de colonnes pseudo | score | ema (cf. SND_COLUMNS) */}
      {[
        SND_COLUMNS[0].x,
        SND_COLUMNS[1].x,
        SND_COLUMNS[1].x + SND_COLUMNS[1].width,
        SND_COLUMNS[2].x,
        SND_COLUMNS[2].x + SND_COLUMNS[2].width,
      ].map((x, idx) => (
        <div
          key={idx}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: pct(x),
            borderLeft: `1px dashed ${color}80`,
          }}
        />
      ))}
      {/* poignée resize */}
      <div
        onPointerDown={startDrag("resize")}
        style={{
          position: "absolute",
          right: -6,
          bottom: -6,
          width: 12,
          height: 12,
          background: color,
          cursor: "nwse-resize",
          borderRadius: 2,
        }}
      />
    </div>
  );
}

function TeamTable({
  title,
  rows,
  setRows,
}: {
  title: string;
  rows: Row[];
  setRows: (r: Row[]) => void;
}) {
  const upd = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div style={{ marginBottom: 16 }}>
      <h3>{title}</h3>
      <table style={S.table}>
        <thead>
          <tr>
            <th>Pseudo</th>
            <th>K</th>
            <th>D</th>
            <th>A</th>
            <th>Score</th>
            <th>MVP</th>
            <th>Conf.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const statCell = r.confidence < LOW_CONF ? S.tdLow : S.td;
            const pseudoCell = r.pseudo_confidence < LOW_CONF ? S.tdLow : S.td;
            return (
              <tr key={i}>
                <td style={pseudoCell}>
                  <input value={r.pseudo} onChange={(e) => upd(i, { pseudo: e.target.value })} style={S.cellIn} />
                </td>
                <td style={statCell}><input type="number" value={r.kills} onChange={(e) => upd(i, { kills: +e.target.value })} style={S.cellNum} /></td>
                <td style={statCell}><input type="number" value={r.deaths} onChange={(e) => upd(i, { deaths: +e.target.value })} style={S.cellNum} /></td>
                <td style={statCell}><input type="number" value={r.assists} onChange={(e) => upd(i, { assists: +e.target.value })} style={S.cellNum} /></td>
                <td style={statCell}><input type="number" value={r.score ?? 0} onChange={(e) => upd(i, { score: +e.target.value })} style={S.cellNum} /></td>
                <td style={S.td}><input type="checkbox" checked={r.is_mvp} onChange={(e) => upd(i, { is_mvp: e.target.checked })} /></td>
                <td style={S.td}>{r.confidence.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

const S: Record<string, React.CSSProperties> = {
  main: { fontFamily: "system-ui, sans-serif", padding: "1.5rem", maxWidth: 900, margin: "0 auto" },
  section: { marginTop: 24, paddingTop: 8, borderTop: "1px solid #eee" },
  hint: { color: "#666", fontSize: "0.9rem" },
  imgWrap: { position: "relative", userSelect: "none", touchAction: "none", maxWidth: 820 },
  num: { width: 64, padding: 4 },
  btn: { padding: "8px 16px", fontSize: "1rem", cursor: "pointer" },
  table: { borderCollapse: "collapse", width: "100%" },
  td: { border: "1px solid #ddd", padding: 2, textAlign: "center" },
  tdLow: { border: "1px solid #ddd", padding: 2, textAlign: "center", background: "#fff3cd" },
  cellIn: { width: "100%", boxSizing: "border-box", padding: 4 },
  cellNum: { width: 48, padding: 4, textAlign: "center" },
  result: { background: "#f6f8fa", padding: 12, overflowX: "auto", marginTop: 12 },
};
