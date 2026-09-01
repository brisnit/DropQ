#!/usr/bin/env node
/**
 * Refuse a production-affecting Prisma command unless it was clearly intended.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * On 31 August 2026 `prisma migrate deploy` was run to validate a migration
 * against a throwaway cluster, with DATABASE_URL set in the environment to that
 * cluster. The Prisma CLI loaded this repository's `.env` in preference to the
 * variable it was given and applied the migration to production. The migration
 * was additive so the damage was nil, but nothing about the command made that
 * likely — the same mistake on an ALTER or a backfill would have been an
 * incident. See docs/MIGRATION-SAFETY.md.
 *
 * The root cause is that this repo's `.env` points at production. Fixing that
 * properly is a separate task. This is the small guard in the meantime: it
 * makes the dangerous path say the word "production" out loud.
 *
 * ── HOW IT BEHAVES ────────────────────────────────────────────────────────
 *
 * It resolves DATABASE_URL exactly the way the Prisma CLI does — the `.env`
 * file wins, which is the whole trap — and if the host is production it
 * requires CONFIRM_PRODUCTION_MIGRATION=1.
 *
 * FAILS CLOSED. If the URL cannot be read or parsed, if the host cannot be
 * determined, if anything at all is uncertain, it refuses. A guard that lets
 * you through when it is confused is not a guard.
 *
 * NEVER PRINTS THE URL. Not on success, not on failure, not in a stack trace.
 * The host is shown; the credentials, database name and query string are not.
 *
 * Usage:
 *   node scripts/db-guard.mjs                      # check only
 *   node scripts/db-guard.mjs migrate deploy       # check, then run via the
 *                                                  # repo-local prisma binary
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/**
 * The production database host.
 *
 * Matched on the Neon endpoint id, which is stable and is not a secret — it
 * appears in `prisma migrate status` output. Deliberately a substring match on
 * the HOST only, never on the full URL, so no credential is ever compared,
 * logged or held in a variable that could be printed.
 */
const PRODUCTION_HOST_MARKERS = ["ep-rough-cake-atlwek15"];

/** Prisma subcommands that can change a database. */
const MUTATING = [
  "migrate deploy",
  "migrate dev",
  "migrate reset",
  "migrate resolve",
  "db push",
  "db seed",
  "db execute",
];

/**
 * Resolve DATABASE_URL the way the Prisma CLI does.
 *
 * This is the important part: Prisma reads `.env` from the project root, and on
 * 31 Aug that took precedence over the process environment. The guard must
 * therefore check what PRISMA will use, not what the caller thinks it set —
 * otherwise it would have cheerfully approved the exact command that caused the
 * incident. When the two disagree, both are checked and either one matching
 * production is enough to require confirmation.
 */
function candidateUrls() {
  const urls = [];
  if (process.env.DATABASE_URL) urls.push(process.env.DATABASE_URL);
  const envFile = join(ROOT, ".env");
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.+)$/m);
    if (m) urls.push(m[1].trim().replace(/^["']|["']$/g, ""));
  }
  return urls;
}

/** The host, and nothing else. Never returns or throws anything with credentials in it. */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function refuse(message) {
  console.error(`\n✖ db-guard: ${message}\n`);
  process.exit(1);
}

const urls = candidateUrls();
if (urls.length === 0) {
  refuse("no DATABASE_URL is set and none was found in .env. Refusing (fail closed).");
}

const hosts = urls.map(hostOf);
if (hosts.some((h) => h === null)) {
  refuse("a DATABASE_URL could not be parsed, so its target is unknown. Refusing (fail closed).");
}

const productionHosts = hosts.filter((h) => PRODUCTION_HOST_MARKERS.some((m) => h.includes(m)));
const isProduction = productionHosts.length > 0;
const confirmed = process.env.CONFIRM_PRODUCTION_MIGRATION === "1";

const command = process.argv.slice(2);
const commandText = command.join(" ");
const mutates = command.length === 0 || MUTATING.some((m) => commandText.startsWith(m));

if (isProduction && mutates && !confirmed) {
  refuse(
    `this would run against PRODUCTION (${productionHosts[0]}).\n\n` +
      `  If that is genuinely what you want:\n` +
      `      CONFIRM_PRODUCTION_MIGRATION=1 node scripts/db-guard.mjs ${commandText || "migrate deploy"}\n\n` +
      `  If you are VALIDATING a migration, you do not want production at all:\n` +
      `      node scripts/verify-migrations.mjs\n\n` +
      `  Never use \`prisma migrate deploy\` to test a migration — this repo's .env\n` +
      `  points at production and the CLI prefers it over your environment.\n` +
      `  See docs/MIGRATION-SAFETY.md.`
  );
}

if (command.length === 0) {
  console.log(
    isProduction
      ? `db-guard: target is PRODUCTION (${productionHosts[0]}) — confirmed by CONFIRM_PRODUCTION_MIGRATION=1`
      : `db-guard: target is ${hosts[0]} — not production, no confirmation required`
  );
  process.exit(0);
}

// Repo-local Prisma, never `npx`. Outside this repo `npx prisma` resolves a
// DIFFERENT, newer CLI — one in which `migrate` has been renamed to
// `migration` — so trusting npx to find the pinned version is not safe either.
const prisma = join(ROOT, "node_modules", ".bin", "prisma");
if (!existsSync(prisma)) refuse("node_modules/.bin/prisma is missing. Run npm install.");

console.log(
  `db-guard: running \`prisma ${commandText}\` against ` +
    (isProduction
      ? `PRODUCTION (${productionHosts[0]})` +
        (mutates ? ", confirmed" : " — read-only command, no confirmation needed")
      : hosts[0])
);
const result = spawnSync(prisma, command, { cwd: ROOT, stdio: "inherit" });
process.exit(result.status ?? 1);
