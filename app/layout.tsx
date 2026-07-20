import type { ReactNode } from "react";

export const metadata = {
  title: "OCR Resultat — Service d'ingestion",
  description:
    "Service d'ingestion de resultats de match par capture d'ecran. Valideur d'API.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
