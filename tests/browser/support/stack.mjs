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
 * @param appUrl  Overrides APP_URL for the app process only. The screenshot
 *   runner sets the canonical production origin so that share links and the QR
 *   codes built from them read `drop-q.com` in documentation images instead of
 *   the capture machine's port. Specs leave it alone and get the local URL.
 */
export async function startStack({ fresh = false, verbose = false, appUrl = APP_URL } = {}) {
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
  };

  const push = spawnSync(
    join(ROOT, "node_modules", ".bin", "prisma"),
    ["db", "push", "--skip-generate", "--accept-data-loss"],
    { cwd: ROOT, env, stdio: verbose ? "inherit" : "ignore" }
  );
  if (push.status !== 0) throw new Error("prisma db push failed");

  const server = spawn("npm", ["run", "dev", "--", "--port", String(APP_PORT)], {
    cwd: ROOT,
    env,
    stdio: verbose ? "inherit" : "ignore",
  });

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`${APP_URL}/login`, { redirect: "manual" });
      if (r.status < 500) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) {
      server.kill("SIGTERM");
      await db.stop();
      throw new Error(`app did not start on ${APP_URL}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  return {
    url: db.url,
    env,
    async stop() {
      if (server && !server.killed) server.kill("SIGTERM");
      await db.stop().catch(() => {});
    },
  };
}
