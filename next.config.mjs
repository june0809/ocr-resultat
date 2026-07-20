/** @type {import('next').NextConfig} */
const nextConfig = {
  // Le service est un valideur d'API. CORS de la page d'upload : voir §8 du SPEC.
  // La whitelist du domaine d'upload est appliquee dans le handler (lib/cors.ts)
  // plutot qu'ici, pour rester dependante de l'env (dev vs prod).
  reactStrictMode: true,
};

export default nextConfig;
