/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // 🔴 IMPORTANT : active le mode export statique
  // => `next build` va générer un dossier `out/`
  output: "export",

  // 🔴 IMPORTANT pour un hébergement statique (Firebase Hosting)
  // Pas d'image optimizer côté serveur
  images: {
    unoptimized: true,
  },

  // Tu l'avais déjà pour pdfjs
  transpilePackages: ["pdfjs-dist"],

  webpack: (config, { dev, isServer }) => {
    // Workaround qui était déjà dans ton projet
    if (dev && !isServer) {
      config.devtool = "source-map"; // ou "cheap-module-source-map"
    }
    return config;
  },

  experimental: {},
};

export default nextConfig;
