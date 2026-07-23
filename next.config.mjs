/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
