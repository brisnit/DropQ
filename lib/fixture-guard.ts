import "server-only";

/**
 * The one gate between a fixture-producing self-test and a real database.
 *
 * WHY THIS EXISTS. Five `/api/dev/*-selftest` routes create sellers, customers,
 * drops and orders as fixtures and delete them again in a `finally`. Run through
 * `npm run dev`, whose `.env` in this repo points at PRODUCTION, they created
 * those fixtures in production and relied entirely on teardown to undo it.
 *
 * Teardown is not a safety mechanism. It is the happy path. On 2026-08-30 a
 * schema mismatch made `seller.delete()` throw — the delete returns the deleted
 * row, which selected columns that did not exist yet — and eight fixture vendors
 * were left in production, two of them as publicly reachable storefronts. A
 * separate leak in the messaging suite had been depositing one "OAuth Tester"
 * customer per successful run since 2026-08-14; fourteen had accumulated,
 * 56% of the customer table.
 *
 * So: a fixture test now REFUSES to run anywhere except the harness database.
 * Not "cleans up carefully" — refuses.
 *
 * WHAT THIS IS NOT. Read-only production diagnostics are untouched and remain
 * valuable: `scripts/phase-a-selftest.mjs` asking production whether any live
 * drop belongs to a non-charge-ready vendor is exactly the sort of question
 * worth asking of real data. Those callers never import this module. The
 * dividing line is writing, not connecting.
 */

/** Host, port and database of the throwaway cluster the browser harness owns. */
export const FIXTURE_HOST = "localhost";
export const FIXTURE_PORT = "55432";
export const FIXTURE_DB = "dropq_browser_test";

export type FixtureRefusal = {
  reason: string;
  detail: string;
};

/**
 * Why fixtures may not be created here — or null when they may.
 *
 * FAILS CLOSED at every step. A missing URL, an unparseable URL, an unexpected
 * host, an unexpected database name: all refusals. The only way to get a null
 * out of this function is to be pointed at the harness database, in a local
 * process, with no hosting environment set.
 */
export function fixtureRefusal(
  env: Record<string, string | undefined> = process.env
): FixtureRefusal | null {
  // 1. Anything Vercel runs. Preview shares DATABASE_URL with production, so
  //    "not production" is not good enough — the check is "not hosted at all".
  if (env.VERCEL_ENV) {
    return {
      reason: "hosted_environment",
      detail: `VERCEL_ENV=${env.VERCEL_ENV}. Fixture tests never run on Vercel; preview shares the production database.`,
    };
  }
  if (env.VERCEL === "1") {
    return { reason: "hosted_environment", detail: "running on Vercel" };
  }
  if (env.NODE_ENV === "production") {
    return { reason: "production_build", detail: "NODE_ENV=production" };
  }

  // 2. The database itself. This is the check that actually matters: NODE_ENV
  //    says nothing about where DATABASE_URL points, and in this repo `.env`
  //    points at production while NODE_ENV is "development".
  const url = env.DATABASE_URL;
  if (!url) {
    return { reason: "no_database_url", detail: "DATABASE_URL is not set" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      reason: "unparseable_database_url",
      detail: "DATABASE_URL is not a valid URL — refusing rather than guessing",
    };
  }

  const host = parsed.hostname;
  const port = parsed.port;
  const name = parsed.pathname.replace(/^\//, "");
  const isLocal = host === FIXTURE_HOST || host === "127.0.0.1" || host === "::1";

  if (!isLocal || port !== FIXTURE_PORT || name !== FIXTURE_DB) {
    return {
      reason: "not_the_fixture_database",
      detail:
        `expected ${FIXTURE_HOST}:${FIXTURE_PORT}/${FIXTURE_DB}, ` +
        `got ${host || "(no host)"}:${port || "(no port)"}/${name || "(no database)"}`,
    };
  }

  return null;
}

/** True when fixtures may be created. */
export function fixturesAllowed(
  env: Record<string, string | undefined> = process.env
): boolean {
  return fixtureRefusal(env) === null;
}

/**
 * The message a refused self-test returns.
 *
 * Says what to run instead, because the failure mode this replaces was someone
 * curling a self-test at localhost:3000 and unknowingly writing to production.
 * A refusal that does not tell you the safe path just gets worked around.
 */
export function fixtureRefusalBody(refusal: FixtureRefusal) {
  return {
    error: "fixtures_refused",
    reason: refusal.reason,
    detail: refusal.detail,
    remedy:
      "This self-test creates and deletes application records, so it only runs " +
      `against the isolated harness database (${FIXTURE_HOST}:${FIXTURE_PORT}/${FIXTURE_DB}). ` +
      "Run `npm run test:selftests`, which boots that database, starts the app " +
      "against it and calls every self-test route.",
  };
}
