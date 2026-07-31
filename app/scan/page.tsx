"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Worker } from "tesseract.js";
import {
  createBrowserWorker,
  readScoreboardWith,
  type OcrResult,
  type RoundScore,
} from "@/lib/ocr/browser";
import { S } from "./styles";

/**
 * SAISIE D'UN RESULTAT DE MATCH depuis une capture.
 *
 * Difference avec /upload : celle-ci est un banc de moteur (elle lit et affiche,
 * point). Ici on va jusqu'au bout du parcours — corriger, puis enregistrer.
 *
 * Deux partis pris :
 *
 * 1. L'OCR tourne DANS LE NAVIGATEUR. Mesure : ~2 s ici contre plus de 60 s sur
 *    une fonction serverless du palier gratuit. En prime la capture ne quitte
 *    pas l'appareil — seuls les chiffres relus partent sur le reseau.
 *
 * 2. Rien n'est envoye sans relecture humaine. L'OCR se trompe surtout sur les
 *    pseudos stylises ; les cellules peu sures sont donc surlignees et TOUT est
 *    editable. Le bouton d'envoi dit ce qu'il fait, et l'organisateur voit les
 *    chiffres exacts qu'il valide.
 *
 * La cle d'API ne transite jamais par cette page : l'envoi passe par
 * /api/scan, qui la detient cote serveur.
 */

interface Row {
  pseudo: string;
  kills: string;
  deaths: string;
  assists: string;
  is_mvp: boolean;
  confidence: number;
  pseudoConfidence: number;
}

interface TeamState {
  side: "blue" | "red";
  rows: Row[];
  roundsWon: string;
}

/**
 * Seuils de surlignage — deux valeurs, parce que les deux colonnes n'ont pas du
 * tout le meme comportement.
 *
 * PSEUDO : cale sur le seuil de warning du service (§5.3), pour que
 * l'organisateur voie exactement ce que le service jugera douteux. Les pseudos
 * stylises sont la vraie source d'erreur, ils meritent d'etre tous signales.
 *
 * STATS : seuil plus bas. Mesure sur les captures de reference — les 30 K/D/A
 * etaient TOUS exacts, y compris ceux annonces a 0.26 de confiance. Sur des
 * chiffres, la confiance de Tesseract correle mal avec l'exactitude : surligner
 * a 0.90 noircissait la moitie du tableau de cellules pourtant justes, ce qui
 * apprend a l'organisateur a ignorer le surlignage. Un signal qu'on ignore ne
 * sert a rien.
 */
const LOW_CONF_PSEUDO = 0.9;
const LOW_CONF_STAT = 0.7;

type Phase =
  | { step: "vide" }
  | { step: "lecture"; progress: number }
  | { step: "pret" }
  | { step: "envoi" }
  | { step: "envoye"; matchId: string }
  | { step: "erreur"; message: string };

export default function ScanPage() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [teams, setTeams] = useState<TeamState[]>([]);
  const [phase, setPhase] = useState<Phase>({ step: "vide" });
  const [ms, setMs] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Le worker coute ~0,3 s a initialiser : on le garde entre deux captures, ce
  // qui compte quand un organisateur enchaine les matchs d'un tournoi.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const charger = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setPhase({ step: "erreur", message: "Ce fichier n'est pas une image." });
      return;
    }
    setImgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setFileName(file.name);
    setTeams([]);
    setMs(null);
    setPhase({ step: "vide" });
  }, []);

  // Coller une capture (Ctrl+V) : c'est le geste naturel apres une capture
  // d'ecran, et ca evite le detour par un fichier enregistre.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (file) charger(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [charger]);

  const lire = useCallback(async () => {
    const img = imgRef.current;
    if (!img) return;
    setPhase({ step: "lecture", progress: 0 });
    const t0 = performance.now();
    try {
      workerRef.current ??= await createBrowserWorker({
        // Servis depuis notre domaine (scripts/sync-tesseract-assets.mjs) :
        // aucune dependance a un CDN tiers.
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tesseract/lang",
        onProgress: (p) => setPhase({ step: "lecture", progress: p }),
      });
      const out = await readScoreboardWith(
        workerRef.current,
        img,
        img.naturalWidth,
        img.naturalHeight,
        { game: "codm", mode: "team_deathmatch" }
      );
      if (!out.ok) {
        setPhase({ step: "erreur", message: messageLecture(out.reason) });
        return;
      }
      setTeams(versEtat(out.result, out.roundScore));
      setPhase({ step: "pret" });
    } catch (e) {
      setPhase({ step: "erreur", message: (e as Error).message });
    } finally {
      setMs(Math.round(performance.now() - t0));
    }
  }, []);

  const modifier = useCallback(
    (ti: number, ri: number, champ: keyof Row, valeur: string | boolean) => {
      setTeams((prev) =>
        prev.map((t, i) =>
          i !== ti
            ? t
            : { ...t, rows: t.rows.map((r, j) => (j !== ri ? r : { ...r, [champ]: valeur })) }
        )
      );
    },
    []
  );

  const envoyer = useCallback(async () => {
    setPhase({ step: "envoi" });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(versPayload(teams)),
      });
      const json = await res.json();
      if (!res.ok) {
        setPhase({
          step: "erreur",
          message: `${json?.error?.code ?? res.status} — ${json?.error?.message ?? "envoi refuse"}`,
        });
        return;
      }
      setPhase({ step: "envoye", matchId: json.match_id });
    } catch (e) {
      setPhase({ step: "erreur", message: (e as Error).message });
    }
  }, [teams]);

  const vainqueur = teams.find(
    (t) => t.roundsWon !== "" && teams.every((a) => a === t || num(a.roundsWon) < num(t.roundsWon))
  );
  const manchesCompletes = teams.length === 2 && teams.every((t) => t.roundsWon !== "");
  const egalite = manchesCompletes && !vainqueur;

  return (
    <main style={S.main}>
      <h1 style={S.h1}>Enregistrer un match</h1>
      <p style={S.hint}>
        Depose la capture du tableau de fin de partie. La lecture se fait <strong>sur ton
        appareil</strong> — l&apos;image n&apos;est envoyee nulle part. Verifie les chiffres,
        corrige ce qui est surligne, puis enregistre.
      </p>

      <Depot onFichier={charger} nom={fileName} />

      {imgUrl && (
        <>
          <div style={S.apercu}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={imgUrl} alt="capture du tableau de fin de partie" style={S.img} />
          </div>
          <div style={S.barre}>
            <button
              onClick={lire}
              disabled={phase.step === "lecture" || phase.step === "envoi"}
              style={S.btnPrimaire}
            >
              {phase.step === "lecture" ? "Lecture en cours…" : "Lire la capture"}
            </button>
            {phase.step === "lecture" && (
              <span style={S.progres}>{Math.round(phase.progress * 100)} %</span>
            )}
            {ms !== null && phase.step !== "lecture" && <span style={S.meta}>{ms} ms</span>}
          </div>
        </>
      )}

      {phase.step === "erreur" && (
        <p style={S.erreur} role="alert">
          {phase.message}
        </p>
      )}

      {phase.step === "envoye" && (
        <div style={S.succes} role="status">
          <strong>Match enregistre.</strong>
          <div style={S.meta}>Reference : {phase.matchId}</div>
        </div>
      )}

      {teams.length > 0 && phase.step !== "envoye" && (
        <>
          {teams.map((team, ti) => (
            <section key={team.side} style={S.section}>
              <header style={S.entete}>
                <h2 style={S.h2}>
                  <span style={{ ...S.pastille, background: team.side === "blue" ? "#3b6fd4" : "#c14a4a" }} />
                  Equipe {team.side === "blue" ? "bleue" : "rouge"}
                  <span style={S.cote}>({team.side === "blue" ? "gauche" : "droite"} de la capture)</span>
                </h2>
                <label style={S.manches}>
                  Manches gagnees
                  <input
                    inputMode="numeric"
                    value={team.roundsWon}
                    onChange={(e) =>
                      setTeams((prev) =>
                        prev.map((t, i) => (i === ti ? { ...t, roundsWon: chiffres(e.target.value) } : t))
                      )
                    }
                    style={{ ...S.champ, width: 56, textAlign: "center" }}
                    aria-label={`Manches gagnees par l'equipe ${team.side === "blue" ? "bleue" : "rouge"}`}
                  />
                </label>
              </header>

              <Tableau rows={team.rows} onChange={(ri, c, v) => modifier(ti, ri, c, v)} />
            </section>
          ))}

          <div style={S.pied}>
            <div style={S.resume}>
              {egalite ? (
                <span style={S.avert}>
                  Manches a egalite — corrige le score, le vainqueur ne peut pas etre deduit.
                </span>
              ) : vainqueur ? (
                <>
                  Vainqueur : <strong>equipe {vainqueur.side === "blue" ? "bleue" : "rouge"}</strong>{" "}
                  ({teams.map((t) => t.roundsWon || "?").join(" — ")})
                </>
              ) : (
                <span style={S.avert}>
                  Score de manches non lu — saisis-le, c&apos;est lui qui designe le vainqueur.
                </span>
              )}
            </div>
            <button
              onClick={envoyer}
              disabled={!manchesCompletes || !!egalite || phase.step === "envoi"}
              style={S.btnPrimaire}
            >
              {phase.step === "envoi" ? "Enregistrement…" : "Enregistrer le match"}
            </button>
          </div>
        </>
      )}
    </main>
  );
}

// --- Sous-composants --------------------------------------------------------

function Depot({ onFichier, nom }: { onFichier: (f: File) => void; nom: string }) {
  const [survol, setSurvol] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setSurvol(true);
      }}
      onDragLeave={() => setSurvol(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSurvol(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFichier(f);
      }}
      style={{ ...S.depot, ...(survol ? S.depotSurvol : {}) }}
    >
      <input
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && onFichier(e.target.files[0])}
        style={S.inputCache}
      />
      <strong>Depose une capture ici</strong>
      <span style={S.meta}>ou clique pour choisir un fichier — tu peux aussi coller (Ctrl+V)</span>
      {nom && <span style={S.meta}>Charge : {nom}</span>}
    </label>
  );
}

function Tableau({
  rows,
  onChange,
}: {
  rows: Row[];
  onChange: (ri: number, champ: keyof Row, valeur: string | boolean) => void;
}) {
  return (
    <div style={S.scroll}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, textAlign: "left" }}>Pseudo</th>
            <th style={S.th}>Kills</th>
            <th style={S.th}>Morts</th>
            <th style={S.th}>Assists</th>
            <th style={S.th}>MVP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={S.td}>
                <input
                  value={r.pseudo}
                  onChange={(e) => onChange(i, "pseudo", e.target.value)}
                  style={{
                    ...S.champ,
                    ...(r.pseudoConfidence < LOW_CONF_PSEUDO ? S.champDouteux : {}),
                  }}
                  placeholder="pseudo illisible"
                  aria-label={`Pseudo du joueur ${i + 1}`}
                />
              </td>
              {(["kills", "deaths", "assists"] as const).map((champ) => (
                <td key={champ} style={S.td}>
                  <input
                    inputMode="numeric"
                    value={r[champ]}
                    onChange={(e) => onChange(i, champ, chiffres(e.target.value))}
                    style={{
                      ...S.champ,
                      width: 56,
                      textAlign: "center",
                      ...(r.confidence < LOW_CONF_STAT ? S.champDouteux : {}),
                    }}
                    aria-label={`${champ} du joueur ${i + 1}`}
                  />
                </td>
              ))}
              <td style={{ ...S.td, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={r.is_mvp}
                  onChange={(e) => onChange(i, "is_mvp", e.target.checked)}
                  aria-label={`MVP joueur ${i + 1}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Conversions ------------------------------------------------------------

const chiffres = (v: string) => v.replace(/\D/g, "").slice(0, 4);
const num = (v: string) => (v === "" ? -1 : parseInt(v, 10));
const txt = (n: number | null) => (n === null ? "" : String(n));

function versEtat(ocr: OcrResult, round: RoundScore | null): TeamState[] {
  return ocr.teams.map((t) => ({
    side: t.side,
    roundsWon: round ? String(round[t.side]) : "",
    // `p.score` (le score individuel du tableau) est volontairement ignore : il
    // n'est PAS transmis au service, et il se lit mal — le badge MVP colle a sa
    // gauche mange le nombre sur les 1res lignes. Afficher une colonne peu fiable
    // que personne ne consomme reviendrait a faire corriger une valeur qui ne va
    // nulle part, tout en jetant le doute sur les chiffres qui, eux, comptent.
    rows: t.players.map((p) => ({
      pseudo: p.pseudo,
      kills: txt(p.kills),
      deaths: txt(p.deaths),
      assists: txt(p.assists),
      is_mvp: p.is_mvp,
      confidence: p.confidence,
      pseudoConfidence: p.pseudo_confidence,
    })),
  }));
}

/**
 * Etat de l'ecran -> corps `source: "web"` du contrat (§6.1).
 *
 * On envoie ce que l'organisateur a VALIDE, sans confidence par joueur : apres
 * relecture humaine, ces chiffres sont surs. Laisser filtrer les confiances de
 * l'OCR ferait lever des warnings sur des valeurs pourtant corrigees a la main.
 */
function versPayload(teams: TeamState[]) {
  const manches = teams.map((t) => num(t.roundsWon));
  const max = Math.max(...manches);
  return {
    source: "web" as const,
    game: "codm",
    mode: "team_deathmatch" as const,
    captured_at: new Date().toISOString(),
    extracted: {
      teams: teams.map((t, i) => ({
        placement: manches[i] === max ? 1 : 2,
        rounds_won: manches[i],
        players: t.rows
          // Une ligne sans pseudo ne designe personne : l'envoyer creerait un
          // joueur fantome cote client. On la laisse de cote.
          .filter((r) => r.pseudo.trim() !== "")
          .map((r) => ({
            pseudo: r.pseudo.trim(),
            kills: num0(r.kills),
            deaths: num0(r.deaths),
            assists: num0(r.assists),
            is_mvp: r.is_mvp,
          })),
      })),
    },
  };
}

const num0 = (v: string) => (v === "" ? 0 : parseInt(v, 10));

/** Traduit les echecs du moteur en consigne actionnable : "barres non detectees"
 *  n'aide personne, "cadre bien le tableau" si. */
function messageLecture(raison: string): string {
  if (raison.includes("barres")) {
    return "Tableaux non reperes. Verifie que la capture montre bien l'ecran de fin de partie entier, avec les deux bandeaux bleu et rouge.";
  }
  if (raison.includes("lignes")) {
    return "Lignes de joueurs non reperees. Une capture moins compressee ou non recadree donne generalement un meilleur resultat.";
  }
  return `Lecture impossible : ${raison}`;
}
