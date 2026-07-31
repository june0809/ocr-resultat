/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // tesseract.js et sharp doivent rester HORS du bundle serveur.
  //
  // Tous deux resolvent des fichiers a cote d'eux a l'execution — tesseract.js
  // son script de worker Node, sharp son binaire natif — a partir de __dirname.
  // Bundles, __dirname devient une racine fictive et la resolution echoue :
  //   Cannot find module 'D:\ROOT\node_modules\tesseract.js\src\worker-script\node\index.js'
  // Le chemin image de /v1/matches plantait donc des le premier appel en build de
  // production (invisible au banc `npm run e2e`, qui execute la source sans
  // passer par le bundler).
  serverExternalPackages: ["tesseract.js", "sharp"],
  // Vercel : la fonction serverless de /v1/matches doit embarquer la traineddata
  // VENDOREE (@tesseract.js-data/eng) + le core WASM de tesseract.js, sinon l'OCR
  // tente de les telecharger au runtime (impossible : FS read-only + pas de CDN).
  outputFileTracingIncludes: {
    "/v1/matches": [
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**",
      "./node_modules/tesseract.js-core/**",
    ],
  },
};

export default nextConfig;
