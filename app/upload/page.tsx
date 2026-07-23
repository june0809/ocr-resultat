"use client";

import { useCallback, useRef, useState } from "react";
import { readScoreboardFromImage, type OcrResult } from "@/lib/ocr/browser";

/**
 * Banc de demonstration NAVIGATEUR du moteur.
 *
 * Ce n'est PAS la surface produit : le parcours reel (import d'une capture dans
 * la saisie de scores, surlignage, rapprochement des pseudos, alias) vit dans
 * l'application cliente — ici on verifie seulement que le moteur lit bien une
 * capture, dans les memes conditions que le client (meme code, meme canvas).
 *
 * Il n'y a plus AUCUNE grille a caler : les tableaux, les lignes et les colonnes
 * sont detectes sur la capture. Le seul geste est de deposer l'image.
 */

interface Row {
  pseudo: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: number | null;
  is_mvp: boolean;
  confidence: number;
  pseudo_confidence: number;
}

const LOW_CONF = 0.75;

export default function UploadPage() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<OcrResult["teams"]>([]);
  const [ms, setMs] = useState<number | null>(null);

  const onFile = useCallback((file: File) => {
    setImgUrl(URL.createObjectURL(file));
    setTeams([]);
    setError(null);
    setMs(null);
  }, []);

  const launch = useCallback(async () => {
    const img = imgRef.current;
    if (!img) return;
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    try {
      const out = await readScoreboardFromImage(img, img.naturalWidth, img.naturalHeight, {
        game: "codm",
        mode: "team_deathmatch",
        // Fichiers tesseract servis depuis ce domaine : aucune dependance CDN.
        onDebug: (m) => console.log(m),
      });
      if (!out.ok) setError(out.reason);
      else setTeams(out.result.teams);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMs(Math.round(performance.now() - t0));
      setBusy(false);
    }
  }, []);

  return (
    <main style={S.main}>
      <h1>Banc moteur — capture CODM</h1>
      <p style={S.hint}>
        L&apos;OCR tourne dans votre navigateur ; la capture ne quitte pas votre appareil.
        Tableaux, lignes et colonnes sont detectes automatiquement — rien a aligner.
      </p>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />

      {imgUrl && (
        <>
          <div style={{ marginTop: 16, maxWidth: 820 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={imgUrl} alt="capture" style={{ width: "100%", display: "block" }} />
          </div>
          <button onClick={launch} disabled={busy} style={S.btn}>
            {busy ? "Lecture en cours…" : "Lire la capture"}
          </button>
          {ms !== null && <span style={{ marginLeft: 12, color: "#666" }}>{ms} ms</span>}
        </>
      )}

      {error && <p style={S.error}>Echec : {error}</p>}

      {teams.map((team) => (
        <section key={team.side} style={S.section}>
          <h2>{team.side === "blue" ? "Equipe bleue (gauche)" : "Equipe rouge (droite)"}</h2>
          <TeamTable
            rows={team.players.map((p) => ({
              pseudo: p.pseudo,
              kills: p.kills,
              deaths: p.deaths,
              assists: p.assists,
              score: p.score,
              is_mvp: p.is_mvp,
              confidence: p.confidence,
              pseudo_confidence: p.pseudo_confidence,
            }))}
          />
        </section>
      ))}
    </main>
  );
}

function TeamTable({ rows }: { rows: Row[] }) {
  return (
    <table style={S.table}>
      <thead>
        <tr>
          <th style={{ width: "40%" }}>Pseudo</th>
          <th>K</th>
          <th>D</th>
          <th>A</th>
          <th>Score</th>
          <th>MVP</th>
          <th>Conf.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={r.pseudo_confidence < LOW_CONF ? S.tdLow : S.td}>{r.pseudo}</td>
            <td style={r.confidence < LOW_CONF ? S.tdLow : S.td}>{r.kills ?? "-"}</td>
            <td style={r.confidence < LOW_CONF ? S.tdLow : S.td}>{r.deaths ?? "-"}</td>
            <td style={r.confidence < LOW_CONF ? S.tdLow : S.td}>{r.assists ?? "-"}</td>
            <td style={S.td}>{r.score ?? "-"}</td>
            <td style={S.td}>{r.is_mvp ? "oui" : ""}</td>
            <td style={S.td}>{r.confidence.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const S: Record<string, React.CSSProperties> = {
  main: { fontFamily: "system-ui, sans-serif", padding: "1.5rem", maxWidth: 900, margin: "0 auto" },
  section: { marginTop: 24, paddingTop: 8, borderTop: "1px solid #eee" },
  hint: { color: "#666", fontSize: "0.9rem" },
  btn: { marginTop: 12, padding: "8px 16px", fontSize: "1rem", cursor: "pointer" },
  error: { color: "#b00020", marginTop: 12 },
  table: { borderCollapse: "collapse", width: "100%" },
  td: { border: "1px solid #ddd", padding: 4, textAlign: "center" },
  tdLow: { border: "1px solid #ddd", padding: 4, textAlign: "center", background: "#fff3cd" },
};
