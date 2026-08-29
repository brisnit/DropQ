/**
 * Production-safety guard for the browser suite.
 *
 * THE RULE: this suite creates and destroys vendors, drops and orders. It must
 * therefore be impossible to point it at anything but the dedicated local
 * verification database — including by accident, including by inheriting a
 * shell that happens to have production's DATABASE_URL exported.
 *
 * Every entry point calls `assertVerifyDatabase()` before touching Prisma. It
 * checks the URL against the exact host, port and database name this harness
 * creates, so a URL that is merely "localhost" (a developer's own dev database,
 * say) is refused just as firmly as a production one.
 */

/**
 * ⚠️ `localhost`, never `127.0.0.1`.
 *
 * Served over a bare-IP origin, the Next dev client runtime never finishes
 * coming up: pages render, every request returns 200, nothing is logged — and
 * React simply never hydrates, so no button works and no key handler is
 * attached. It presents as "the app is broken" and costs an hour to find.
 */
export const VERIFY_HOST = "localhost";
export const VERIFY_PORT = 55432;
export const VERIFY_DB = "dropq_browser_test";
export const VERIFY_USER = "dropq_test";
export const VERIFY_URL = `postgresql://${VERIFY_USER}:${VERIFY_USER}@${VERIFY_HOST}:${VERIFY_PORT}/${VERIFY_DB}`;

/** The app's dev server for the suite. Not 3000, so it can't collide. */
export const APP_PORT = 3123;
export const APP_URL = `http://localhost:${APP_PORT}`;

export function assertVerifyDatabase(url = process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("browser tests must never run with NODE_ENV=production");
  }
  if (!url) throw new Error("DATABASE_URL is not set");

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }

  const host = parsed.hostname;
  const port = parsed.port;
  const name = parsed.pathname.replace(/^\//, "");

  const localHost = host === VERIFY_HOST || host === "localhost";
  if (!localHost || port !== String(VERIFY_PORT) || name !== VERIFY_DB) {
    throw new Error(
      `REFUSING TO RUN.\n` +
        `  This harness writes to the database it is pointed at, so it only ever\n` +
        `  runs against its own throwaway one.\n` +
        `  expected  ${VERIFY_HOST}:${VERIFY_PORT}/${VERIFY_DB}\n` +
        `  got       ${host}:${port || "(none)"}/${name || "(none)"}`
    );
  }
  return url;
}

/** The session secret used to mint test cookies. Never read from .env. */
export const TEST_SESSION_SECRET = "dropq-browser-test-secret";
