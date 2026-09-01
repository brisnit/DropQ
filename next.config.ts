import type { NextConfig } from "next";
import {
  CSP_HEADER_REPORT_ONLY,
  STATIC_SECURITY_HEADERS,
  buildCsp,
} from "./lib/security-headers";

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

  /** `x-powered-by: Next.js` tells an attacker the stack for free. */
  poweredByHeader: false,

  experimental: {
    // Allow product photo uploads through Server Actions (default is 1MB).
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },

  /**
   * Security headers.
   *
   * WHY HERE AND NOT IN MIDDLEWARE. middleware.ts already skips anything with
   * a file extension, so headers set there would miss /brand/*.png,
   * /categories/*.png and every other static asset. next.config applies to the
   * whole surface, and it costs no runtime.
   *
   * Values live in lib/security-headers.ts — see that file for why each header
   * is what it is, and for the two that are deliberately absent (HSTS, which
   * Vercel already sends correctly, and COEP, which would break the map).
   */
  async headers() {
    return [
      {
        // Everything: pages, route handlers, static assets.
        source: "/:path*",
        headers: [...STATIC_SECURITY_HEADERS],
      },
      {
        // HTML DOCUMENTS ONLY. Matching on the Accept header rather than
        // guessing from the path: a navigation asks for text/html, and a
        // script, stylesheet, image or fetch does not. A CSP on a JSON
        // response governs nothing and only costs bytes.
        source: "/:path*",
        has: [{ type: "header", key: "accept", value: ".*text/html.*" }],
        headers: [{ key: CSP_HEADER_REPORT_ONLY, value: buildCsp() }],
      },
    ];
  },
};

export default nextConfig;
