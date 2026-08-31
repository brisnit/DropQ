#!/usr/bin/env node
/**
 * Every `/api/dev/*-selftest` route, against the isolated harness database.
 *
 *   npm run test:selftests
 *   npm run test:selftests -- messaging walkup
 *
 * WHY THIS EXISTS. These suites used to be run by starting `npm run dev` and
 * curling localhost:3000 — and this repo's `.env` points at PRODUCTION, so the
 * five fixture-producing suites created their sellers, customers, drops and
 * orders in the live database and relied on teardown to remove them. Twice it
 * didn't. See lib/fixture-guard.ts.
 *
 * Now those five refuse anywhere but the harness database, and this is the
 * command that gives them one. It boots the same throwaway PostgreSQL cluster
 * the browser suite uses, starts the app against it, and calls every route.
 *
 * The read-only suites run here too. They pass against an empty database as
 * well as a populated one — a suite that needs production data to be meaningful
 * belongs in `scripts/`, run with `--env-file=.env`, and stays read-only.
 */
import { startStack } from "./browser/support/stack.mjs";
import { APP_URL } from "./browser/support/guard.mjs";

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

/**
 * Every self-test route, by kind.
 *
 *   fixtures        creates application records. Harness only — the route
 *                   refuses anywhere else. This is where they run.
 *   productionData  asserts invariants about REAL rows: that no live drop
 *                   belongs to a non-charge-ready vendor, that the admin
 *                   activation queue flags the right vendors. Meaningless
 *                   against an empty database, so skipped here and run with
 *                   `--env-file=.env` instead. Read-only, or (payments) a
 *                   transaction that always rolls back and then proves it did.
 *   otherwise       pure logic and source assertions; runs anywhere.
 */
const SUITES = [
  { name: "activation", productionData: true },
  { name: "analytics" },
  { name: "attribution", fixtures: true },
  { name: "date-picker", fixtures: true },
  { name: "drop-items" },
  { name: "guidance" },
  { name: "help" },
  { name: "isolation" },
  { name: "messaging", fixtures: true },
  { name: "payments", productionData: true },
  { name: "pricing" },
  { name: "rate-limit", fixtures: true },
  { name: "walkup-pay", fixtures: true },
  { name: "walkup-route", fixtures: true },
  { name: "webhook" },
];

const selected = SUITES.filter((s) => only.length === 0 || only.some((o) => s.name.includes(o)));
if (!selected.length) {
  console.error(`no suites matched ${only.join(", ")}`);
  process.exit(1);
}

let stack;
const shutdown = () => { if (stack) void stack.stop(); };
process.on("SIGINT", () => { shutdown(); process.exit(130); });
process.on("SIGTERM", () => { shutdown(); process.exit(143); });

try {
  console.log("• starting isolated stack (postgres → schema → app)…");
  stack = await startStack({ env: { STRIPE_SECRET_KEY: "sk_test_selftests" } });
  console.log(`• app ready on ${APP_URL}\n`);

  let failed = 0;
  let totalPassed = 0;
  for (const suite of selected) {
    if (suite.productionData) {
      console.log(`  – ${suite.name.padEnd(14)} skipped — needs production data, run against .env`);
      continue;
    }
    const res = await fetch(`${APP_URL}/api/dev/${suite.name}-selftest`).catch(() => null);
    const body = await res?.json().catch(() => null);

    if (!res || !body) {
      console.log(`  ✗ ${suite.name.padEnd(14)} no response`);
      failed++;
      continue;
    }
    if (body.error === "fixtures_refused") {
      // The guard fired against the harness database, which means the guard is
      // wrong, not the suite.
      console.log(`  ✗ ${suite.name.padEnd(14)} REFUSED: ${body.detail}`);
      failed++;
      continue;
    }
    const passed = body.passed ?? 0;
    const failures = body.failed ?? (body.checks ? body.checks.filter((c) => !c.pass).length : 0);
    totalPassed += passed;
    if (failures > 0) {
      failed++;
      const detail = (body.results?.filter?.((c) => !c.pass) ?? body.checks?.filter((c) => !c.pass) ?? [])
        .slice(0, 3)
        .map((c) => `      - ${c.name}${c.detail ? ` — ${c.detail}` : ""}`)
        .join("\n");
      console.log(`  ✗ ${suite.name.padEnd(14)} ${passed} passed / ${failures} failed\n${detail}`);
    } else {
      console.log(`  ✓ ${suite.name.padEnd(14)} ${passed} passed${suite.fixtures ? "  (fixtures)" : ""}`);
    }
  }

  await stack.stop();
  console.log(
    failed === 0
      ? `\n✅ ${selected.length} suites, ${totalPassed} checks, all pass`
      : `\n❌ ${failed} suite(s) failed`
  );
  process.exit(failed === 0 ? 0 : 1);
} catch (err) {
  if (stack) await stack.stop().catch(() => {});
  console.error("\n✗ self-tests could not run:\n", err.message);
  process.exit(1);
}
