import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { startDatabase } from "./database.mjs";
import { APP_PORT, APP_URL, TEST_SESSION_SECRET, assertVerifyDatabase } from "./guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..", "..");

/**
 * Bring up the whole isolated stack: throwaway database → schema → app.
 *
 * Shared by the browser suite and the screenshot pipeline so there is one
 * definition of "a safe local DropQ", and in particular ONE place where the
 * app's DATABASE_URL is set explicitly rather than inherited from `.env`
 * (which in this repo points at production).
 */
/**
 * @param env     Extra environment for the app process only.
 * @param appUrl  Overrides APP_URL for the app process only. The screenshot
 *   runner sets the canonical production origin so that share links and the QR
 *   codes built from them read `drop-q.com` in documentation images instead of
 *   the capture machine's port. Specs leave it alone and get the local URL.
 */
export async function startStack({ fresh = false, verbose = false, appUrl = APP_URL, env: extraEnv = {} } = {}) {
  const db = await startDatabase({ fresh });
  assertVerifyDatabase(db.url);

  const env = {
    ...process.env,
    DATABASE_URL: db.url,
    DATABASE_URL_UNPOOLED: db.url,
    SESSION_SECRET: TEST_SESSION_SECRET,
    // Non-empty on purpose: an empty key makes isVendorSellable() allow
    // everything, which would hide the Stripe gate the docs need to show.
    STRIPE_SECRET_KEY: "sk_test_browser_harness",
    APP_URL: appUrl,
    // Per-spec overrides. The analytics spec uses this to run one app with
    // ANALYTICS_MODE=on and a second with VERCEL_ENV=preview, which is the only
    // honest way to prove the preview guard end to end.
    ...extraEnv,
  };

  const push = spawnSync(
    join(ROOT, "node_modules", ".bin", "prisma"),
    ["db", "push", "--skip-generate", "--accept-data-loss"],
    { cwd: ROOT, env, stdio: verbose ? "inherit" : "ignore" }
  );
  if (push.status !== 0) throw new Error("prisma db push failed");

  const app = await startApp({ port: APP_PORT, env, verbose, onFail: () => db.stop() });

  return {
    url: db.url,
    env,
    appUrl: app.url,
    async stop() {
      await app.stop();
      await db.stop().catch(() => {});
    },
  };
}

/**
 * Start ONE app process against an already-running database.
 *
 * Extracted so a spec can run a SECOND app with different environment against
 * the SAME data — which is the only faithful way to test the preview guard.
 * Preview and production share DATABASE_URL in Vercel, so "a preview build
 * pointed at the production database" is a configuration that really exists,
 * and this reproduces it exactly rather than approximating it.
 */
export async function startApp({ port, env, verbose = false, onFail, distDir }) {
  const url = `http://localhost:${port}`;
  const server = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: ROOT,
    // Its own build directory: two dev servers sharing `.next` deadlock on it
    // and the second never becomes reachable.
    env: { ...env, PORT: String(port), ...(distDir ? { NEXT_DIST_DIR: distDir } : {}) },
    stdio: verbose ? "inherit" : "ignore",
  });

  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      const r = await fetch(`${url}/login`, { redirect: "manual" });
      if (r.status < 500) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) {
      server.kill("SIGTERM");
      if (onFail) await onFail();
      throw new Error(`app did not start on ${url}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  return {
    url,
    async stop() {
      if (server && !server.killed) server.kill("SIGTERM");
    },
  };
}
