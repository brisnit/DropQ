import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Build output directory.
   *
   * Overridable so the browser harness can run more than one dev server against
   * this project at once — two `next dev` processes sharing `.next` fight over
   * the same files and one of them never finishes starting. The analytics spec
   * needs three apps (analytics off, on, and a preview build) against one
   * database, which is the only faithful way to test the preview guard.
   *
   * Unset in every real environment, so production builds are unaffected.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // Allow product photo uploads through Server Actions (default is 1MB).
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
