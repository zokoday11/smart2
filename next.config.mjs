/** @type {import('next').NextConfig} */
const nextConfig = {
  // On demande à Next de générer un site statique dans `out/`
  output: "export",

  // Utile si tu utilises `next/image` (sinon tu peux enlever)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
