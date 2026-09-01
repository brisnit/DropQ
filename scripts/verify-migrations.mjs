/**
 * Replay the whole migration folder into a throwaway database and compare the
 * result to schema.prisma.
 *
 * `migrate diff --from-migrations` takes the shadow database URL EXPLICITLY and
 * never reads the datasource url, so unlike `migrate deploy` it cannot resolve
 * DATABASE_URL out of the repo's .env and reach production. That distinction is
 * the whole point of this script.
 */
import EP from "embedded-postgres";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const ROOT = join(import.meta.dirname, "..");
const PRISMA = `${ROOT}/node_modules/.bin/prisma`;
const dir = mkdtempSync(join(tmpdir(), "dropq-migration-verify-"));
const pg = new (EP.default ?? EP)({ databaseDir: dir, user: "s", password: "s", port: 55448, persistent: false });
await pg.initialise(); await pg.start(); await pg.createDatabase("shadow");
const shadow = "postgresql://s:s@localhost:55448/shadow";
const run = (c) => execSync(c, { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
try {
  const diff = run(`${PRISMA} migrate diff --from-migrations ./prisma/migrations ` +
    `--to-schema-datamodel prisma/schema.prisma --shadow-database-url "${shadow}" --script`);
  const drift = diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");
  if (drift) {
    console.error("DRIFT — the migrations do not reproduce schema.prisma:\n" + drift);
    process.exitCode = 1;
  } else {
    console.log("✓ every migration replays to exactly schema.prisma (empty diff)");
  }
} catch (e) {
  console.error("FAILED\n" + [(e.stdout||"").toString(), (e.stderr||"").toString()].join("\n").slice(0, 1200));
  process.exitCode = 1;
} finally {
  await pg.stop();
  rmSync(dir, { recursive: true, force: true });
}
