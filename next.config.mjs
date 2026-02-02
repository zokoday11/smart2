/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Export statique (Firebase Hosting)
  output: "export",

  images: { unoptimized: true },

  transpilePackages: ["pdfjs-dist"],

  // DEV uniquement : proxy /api/* vers Cloud Functions
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/api/:path*",
        destination:
          "https://europe-west1-assistant-ia-v4.cloudfunctions.net/:path*",
      },
    ];
  },
};

export default nextConfig;
