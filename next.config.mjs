/** @type {import('next').NextConfig} */
const nextConfig = {
  // ❌ IMPORTANT : on ne met PAS "output: 'export'"
  // car ton projet utilise des routes API (/api/...)
  // qui nécessitent un runtime Node.js.

  reactStrictMode: true,

  // Tu peux garder cette option si tu veux éviter l’optimisation d'images
  // (utile par ex. pour un déploiement static sur certains hébergeurs)
  images: {
    unoptimized: true,
  },

  // (Optionnel) : si tu veux être explicite sur le runtime Node :
  experimental: {
    serverRuntime: "nodejs",
  },
};

export default nextConfig;
