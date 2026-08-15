import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel maneja el build automáticamente. Si en el futuro quieres
  // self-host (Docker, VPS propio), descomenta la siguiente línea:
  // output: "standalone",

  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
