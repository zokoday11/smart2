/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // pdfjs-dist est ESM et peut poser souci sans transpilation selon ton setup
  transpilePackages: ["pdfjs-dist"],

  // ⚠️ IMPORTANT: supprime "experimental.serverRuntime" (clé invalide)
  experimental: {},
};

export default nextConfig;
