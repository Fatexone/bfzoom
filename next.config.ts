import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true, // 🔒 Active le mode strict pour détecter les erreurs potentielles
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
