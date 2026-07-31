import type { CSSProperties } from "react";

/**
 * Styles de la page de saisie, sortis du composant pour qu'il reste lisible.
 *
 * Styles en ligne plutot qu'une feuille CSS : ce repo n'a ni framework CSS ni
 * convention etablie, et cette page est la seule surface d'interface. Introduire
 * Tailwind ou des modules CSS pour un ecran ferait porter au projet une
 * dependance et un choix d'outillage qu'il n'a pas besoin de trancher
 * maintenant.
 *
 * Les couleurs de surlignage sont volontairement peu saturees : elles doivent
 * attirer l'oeil sans donner l'impression d'une erreur — une confiance basse
 * signale une valeur A VERIFIER, pas une valeur fausse.
 */

const BORDURE = "#d8dbe0";
const TEXTE_SECONDAIRE = "#5f6570";

export const S: Record<string, CSSProperties> = {
  main: {
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
    padding: "2rem 1.5rem 4rem",
    maxWidth: 940,
    margin: "0 auto",
    color: "#1a1d21",
  },
  h1: { fontSize: "1.6rem", margin: "0 0 .5rem" },
  h2: { fontSize: "1.05rem", margin: 0, display: "flex", alignItems: "center", gap: 8 },
  hint: { color: TEXTE_SECONDAIRE, fontSize: ".95rem", lineHeight: 1.5, margin: "0 0 1.5rem" },
  meta: { color: TEXTE_SECONDAIRE, fontSize: ".85rem" },

  depot: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "2rem 1rem",
    border: `2px dashed ${BORDURE}`,
    borderRadius: 10,
    cursor: "pointer",
    textAlign: "center",
    transition: "border-color .15s, background .15s",
  },
  depotSurvol: { borderColor: "#3b6fd4", background: "#f2f6fd" },
  inputCache: { display: "none" },

  apercu: {
    marginTop: 20,
    border: `1px solid ${BORDURE}`,
    borderRadius: 8,
    overflow: "hidden",
    background: "#f7f8fa",
  },
  img: { width: "100%", display: "block" },

  barre: { display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" },
  progres: { color: TEXTE_SECONDAIRE, fontSize: ".9rem", fontVariantNumeric: "tabular-nums" },

  btnPrimaire: {
    padding: "10px 18px",
    fontSize: ".95rem",
    fontWeight: 600,
    color: "#fff",
    background: "#2c5fc4",
    border: "none",
    borderRadius: 7,
    cursor: "pointer",
  },

  section: { marginTop: 28 },
  entete: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  pastille: { width: 11, height: 11, borderRadius: 3, display: "inline-block" },
  cote: { color: TEXTE_SECONDAIRE, fontSize: ".85rem", fontWeight: 400 },
  manches: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: ".9rem",
    color: TEXTE_SECONDAIRE,
  },

  // Les tableaux debordent sur petit ecran : ils defilent dans leur propre
  // conteneur, jamais la page entiere.
  scroll: { overflowX: "auto" },
  table: { borderCollapse: "collapse", width: "100%", minWidth: 560 },
  th: {
    fontSize: ".78rem",
    textTransform: "uppercase",
    letterSpacing: ".04em",
    color: TEXTE_SECONDAIRE,
    fontWeight: 600,
    padding: "6px 8px",
    borderBottom: `1px solid ${BORDURE}`,
    textAlign: "center",
  },
  td: { padding: "4px 6px", borderBottom: "1px solid #eef0f3" },

  champ: {
    width: "100%",
    padding: "6px 8px",
    fontSize: ".92rem",
    fontFamily: "inherit",
    border: `1px solid ${BORDURE}`,
    borderRadius: 5,
    background: "#fff",
    color: "inherit",
  },
  champDouteux: { background: "#fff8e5", borderColor: "#e6c14d" },

  pied: {
    marginTop: 28,
    paddingTop: 16,
    borderTop: `1px solid ${BORDURE}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  },
  resume: { fontSize: ".95rem" },
  avert: { color: "#8a6100" },

  erreur: {
    marginTop: 16,
    padding: "10px 14px",
    background: "#fdf0f0",
    border: "1px solid #e8bcbc",
    borderRadius: 7,
    color: "#8f2020",
    fontSize: ".92rem",
    lineHeight: 1.5,
  },
  succes: {
    marginTop: 20,
    padding: "14px 16px",
    background: "#eef8f0",
    border: "1px solid #b8ddc2",
    borderRadius: 7,
    color: "#1d5e30",
  },
};
