export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>OCR Resultat</h1>
      <p>
        Service d&apos;ingestion de resultats de match par capture d&apos;ecran.
        Ce service expose une API et renvoie du JSON valide. Il ne stocke pas les
        captures et ne connait aucun identifiant de joueur.
      </p>
      <p>
        Endpoint : <code>POST /v1/matches</code> — voir le <code>README.md</code>.
      </p>
      <p>
        <a href="/scan">→ Enregistrer un match depuis une capture</a>
      </p>
      <p style={{ fontSize: "0.9rem", color: "#5f6570" }}>
        <a href="/upload">Banc moteur</a> — lecture brute d&apos;une capture, sans
        enregistrement. Sert a verifier ce que lit l&apos;OCR.
      </p>
    </main>
  );
}
