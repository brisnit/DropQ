import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { VERIFY_DB, VERIFY_PORT, VERIFY_USER, assertVerifyDatabase, VERIFY_URL } from "./guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Cluster lives under tests/browser/.pgdata — gitignored, disposable. */
export const DATA_DIR = join(HERE, "..", ".pgdata");

/**
 * Start (or reuse) the throwaway PostgreSQL cluster this suite owns.
 *
 * A real server rather than a mock: the app runs Prisma against Postgres, and a
 * harness that swapped the database would stop testing the thing that ships.
 */
export async function startDatabase({ fresh = false } = {}) {
  if (fresh && existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: VERIFY_USER,
    password: VERIFY_USER,
    port: VERIFY_PORT,
    persistent: true,
    // Postgres is chatty on start/stop; the suite's own output is the signal.
    onLog: () => {},
    onError: () => {},
  });

  // `initialise()` refuses a non-empty directory, so only run it once.
  if (!existsSync(join(DATA_DIR, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(VERIFY_DB);
  } catch {
    /* already exists */
  }
  assertVerifyDatabase(VERIFY_URL);
  return {
    url: VERIFY_URL,
    stop: async () => {
      try {
        await pg.stop();
      } catch {
        /* already down */
      }
    },
  };
}
