#!/usr/bin/env node
/**
 * Browser suite runner.
 *
 *   npm run test:browser              — every spec
 *   npm run test:browser -- guidance  — just tests/browser/specs/guidance.spec.mjs
 *
 * Boots a throwaway PostgreSQL cluster, pushes the schema into it, starts the
 * app against it on its own port, runs the specs, then tears everything down.
 *
 * ⚠️ PRODUCTION SAFETY. The app is started with an explicit DATABASE_URL for
 * the throwaway database, so it cannot inherit one from `.env` — and every
 * seed helper independently calls `assertVerifyDatabase()` before touching
 * Prisma. See tests/browser/support/guard.mjs.
 *
 * `STRIPE_SECRET_KEY` is set to a dummy so the sell gate is LIVE. With an empty
 * key `isVendorSellable()` short-circuits to "everyone can sell" and half the
 * guidance under test would be unreachable. See the README's local-dev trap.
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { startDatabase } from "./support/database.mjs";
import { APP_PORT, APP_URL, TEST_SESSION_SECRET, assertVerifyDatabase } from "./support/guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

let server;
let db;

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${APP_URL}/login`, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`app did not start on ${APP_URL}`);
}

function shutdown() {
  if (server && !server.killed) server.kill("SIGTERM");
}
process.on("SIGINT", () => { shutdown(); process.exit(130); });
process.on("SIGTERM", () => { shutdown(); process.exit(143); });

try {
  console.log("• starting throwaway postgres…");
  db = await startDatabase({ fresh: process.argv.includes("--fresh-db") });
  assertVerifyDatabase(db.url);

  const env = {
    ...process.env,
    DATABASE_URL: db.url,
    DATABASE_URL_UNPOOLED: db.url,
    SESSION_SECRET: TEST_SESSION_SECRET,
    // A non-empty dummy: keeps the Stripe sell gate live without any network.
    STRIPE_SECRET_KEY: "sk_test_browser_harness",
    APP_URL,
    // ⚠️ Deliberately NOT setting NODE_ENV or PORT. `next dev` sets NODE_ENV
    // itself, and forcing it leaves the client bundle believing it is in a
    // different mode than the server — the page renders, no request fails, no
    // error is logged, and React simply never hydrates. The port goes through
    // the CLI flag only.
  };

  console.log("• pushing schema…");
  const push = spawnSync(
    join(ROOT, "node_modules", ".bin", "prisma"),
    ["db", "push", "--skip-generate", "--accept-data-loss"],
    { cwd: ROOT, env, stdio: "inherit" }
  );
  if (push.status !== 0) throw new Error("prisma db push failed");

  console.log(`• starting app on ${APP_URL}…`);
  server = spawn("npm", ["run", "dev", "--", "--port", String(APP_PORT)], {
    cwd: ROOT,
    env,
    stdio: process.env.BROWSER_VERBOSE ? "inherit" : "ignore",
  });
  await waitForServer();

  const specs = readdirSync(join(HERE, "specs"))
    .filter((f) => f.endsWith(".spec.mjs"))
    .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
    .sort();

  if (specs.length === 0) throw new Error(`no specs matched ${only.join(", ")}`);

  let failed = 0;
  for (const spec of specs) {
    console.log(`\n──────── ${spec} ────────`);
    const run = spawnSync(process.execPath, [join(HERE, "specs", spec)], {
      cwd: ROOT,
      env,
      stdio: "inherit",
    });
    if (run.status !== 0) failed++;
  }

  shutdown();
  await db.stop();
  console.log(failed === 0 ? "\n✅ browser suite passed" : `\n❌ ${failed} spec(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
} catch (err) {
  shutdown();
  if (db) await db.stop().catch(() => {});
  console.error("\n✗ browser suite could not run:\n", err.message);
  process.exit(1);
}
