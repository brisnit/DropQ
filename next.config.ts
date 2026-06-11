import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Allow product photo uploads through Server Actions (default is 1MB).
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
