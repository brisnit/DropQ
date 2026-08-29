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
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { startStack } from "./support/stack.mjs";
import { APP_URL } from "./support/guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

let stack;

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
  if (stack) void stack.stop();
}
process.on("SIGINT", () => { shutdown(); process.exit(130); });
process.on("SIGTERM", () => { shutdown(); process.exit(143); });

try {
  console.log("• starting isolated stack (postgres → schema → app)…");
  stack = await startStack({ fresh: process.argv.includes("--fresh-db"),
                             verbose: !!process.env.BROWSER_VERBOSE });
  console.log(`• app ready on ${APP_URL}`);

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
      env: stack.env,
      stdio: "inherit",
    });
    if (run.status !== 0) failed++;
  }

  await stack.stop();
  console.log(failed === 0 ? "\n✅ browser suite passed" : `\n❌ ${failed} spec(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
} catch (err) {
  if (stack) await stack.stop().catch(() => {});
  console.error("\n✗ browser suite could not run:\n", err.message);
  process.exit(1);
}
