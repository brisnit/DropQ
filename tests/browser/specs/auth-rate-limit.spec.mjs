/**
 * Auth rate limiting, driven through the real login form in a real browser.
 *
 * The self-test route proves the limiter counts correctly. This proves the part
 * that only exists once the limiter is wired to a page a person uses:
 *
 *   - a throttled attempt is INDISTINGUISHABLE from a wrong password. If the
 *     screen ever said "too many attempts", the limiter would have become the
 *     account oracle that the shared error message exists to prevent.
 *   - an unknown email costs the same time as a real one. Before this work,
 *     a missing account skipped bcrypt and answered in a fraction of the time,
 *     which is a free vendor-list enumeration regardless of what the copy says.
 *   - NOTHING IS LOCKED. Once the window passes, the real password works. There
 *     is no unlock step and no admin involvement, because a lockout would let
 *     anyone disable any vendor by failing five logins on their behalf.
 *
 * Runs against the harness database only — it creates a vendor and writes
 * counter rows. Never point it anywhere else.
 */
import prismaModule from "../../../app/generated/prisma/index.js";
import { launch, url, screenshot, recorder } from "../support/browser.mjs";
import { assertVerifyDatabase } from "../support/guard.mjs";
import { openClient } from "../seed/vendor.mjs";
import bcrypt from "bcryptjs";

const DB = assertVerifyDatabase();
const r = recorder("auth-rate-limit");
const browser = await launch();
const db = await openClient(prismaModule, DB);

const REAL_EMAIL = "rate-limit-vendor@example.com";
const REAL_PASSWORD = "correct-horse-battery-staple";
const GHOST_EMAIL = "rate-limit-ghost@example.com";   // deliberately never created

/** The one message every vendor-login failure is allowed to produce. */
const SHARED_ERROR = "Wrong email or password.";

async function reset() {
  await db.$executeRawUnsafe('DELETE FROM "RateLimit"');
  await db.seller.deleteMany({ where: { email: { in: [REAL_EMAIL, GHOST_EMAIL] } } });
  return db.seller.create({
    data: {
      email: REAL_EMAIL,
      passwordHash: await bcrypt.hash(REAL_PASSWORD, 10),
      storeName: "Rate Limit Test Kitchen",
      slug: `rate-limit-${Date.now()}`,
      category: "food",
      emailVerified: true,
      termsAcceptedAt: new Date(),
      referralCode: `RL${Date.now().toString(36).toUpperCase()}`,
      timezone: "America/Los_Angeles",
    },
  });
}

/**
 * One real login attempt. Returns the visible error, the resulting URL, and how
 * long the server took — the three things every assertion below is made of.
 */
async function attempt(page, email, password) {
  await page.goto(url("/login"), { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  const started = Date.now();
  await page.click('button[type="submit"]');
  // Either an error paragraph renders, or the action redirects to the dashboard.
  await Promise.race([
    page.waitForSelector("form p.text-sm", { timeout: 15000 }).catch(() => null),
    page.waitForURL(/\/dashboard/, { timeout: 15000 }).catch(() => null),
  ]);
  const ms = Date.now() - started;
  const error = await page.locator("form p.text-sm").first().textContent().catch(() => null);
  return { error: error?.trim() ?? null, url: page.url(), ms };
}

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

/* ---- 1. A throttled attempt looks exactly like a wrong password ---------- */
{
  r.section("a throttled attempt is indistinguishable from a wrong password");
  await reset();
  const seen = [];
  for (let i = 1; i <= 7; i++) seen.push(await attempt(page, REAL_EMAIL, "wrong-password"));

  r.ok("every failed attempt shows the shared message",
    seen.every((s) => s.error === SHARED_ERROR),
    JSON.stringify([...new Set(seen.map((s) => s.error))]));
  r.ok("no attempt reaches the dashboard", seen.every((s) => !s.url.includes("/dashboard")));
  r.ok("nothing on screen mentions rate limiting, attempts left, or a lockout",
    !/too many|attempt|limit|lock|blocked|wait|later/i.test(
      (await page.locator("body").innerText()).replace(SHARED_ERROR, "")));

  // The sixth attempt is refused before bcrypt runs, so it should come back
  // noticeably faster. That is a real signal — but it leaks nothing an attacker
  // can act on, because it is identical for a real and an unknown account.
  const bcryptRuns = seen.slice(0, 5).map((s) => s.ms);
  const refused = seen.slice(5).map((s) => s.ms);
  console.log(`  · ${`attempts 1–5 ${bcryptRuns.join("/")}ms · attempts 6–7 ${refused.join("/")}ms`}`);

  const rows = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "RateLimit" WHERE "bucket" LIKE 'login:%'`);
  r.ok("login counters were written", rows[0].n > 0, `${rows[0].n} rows`);
  await screenshot(page, "auth-rate-limit-throttled");
}

/* ---- 2. The vendor is not locked out ------------------------------------ */
{
  r.section("no account is ever locked");
  // Exactly what happens when the fifteen-minute window rolls over. The counter
  // rows are keyed by window, so a passed window is simply a different key.
  await db.$executeRawUnsafe('DELETE FROM "RateLimit"');
  const after = await attempt(page, REAL_EMAIL, REAL_PASSWORD);
  r.ok("the real password works once the window passes", after.url.includes("/dashboard"),
    `${after.url} — ${after.error ?? "no error"}`);

  const seller = await db.seller.findUnique({ where: { email: REAL_EMAIL } });
  r.ok("no disable flag was set on the account", !seller.disabledAt);
  r.ok("the password hash was never touched",
    await bcrypt.compare(REAL_PASSWORD, seller.passwordHash));
  await context.clearCookies();
}

/* ---- 3. A correct password costs no budget ------------------------------ */
{
  r.section("a correct password costs no budget");
  await db.$executeRawUnsafe('DELETE FROM "RateLimit"');
  for (let i = 0; i < 3; i++) {
    await attempt(page, REAL_EMAIL, REAL_PASSWORD);
    await context.clearCookies();
  }
  // Counted by BUCKET, not by table. The CSP collector shares this table and
  // consumes its own budget on every violation report, and loading a page now
  // produces those — so "the table is empty" stopped being the same claim as
  // "the login rule counted nothing".
  const rows = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "RateLimit" WHERE "bucket" LIKE 'login:%'`);
  r.ok("three successful logins consume no login budget", rows[0].n === 0, `${rows[0].n} rows`);
}

/* ---- 4. Unknown accounts cost the same as real ones --------------------- */
{
  r.section("unknown accounts cost the same as real ones");
  await db.$executeRawUnsafe('DELETE FROM "RateLimit"');
  const known = [], ghost = [];
  // Interleaved, so a slow moment on the machine hits both samples equally.
  for (let i = 0; i < 4; i++) {
    known.push((await attempt(page, REAL_EMAIL, "wrong-password")).ms);
    ghost.push((await attempt(page, GHOST_EMAIL, "wrong-password")).ms);
    await db.$executeRawUnsafe('DELETE FROM "RateLimit"');
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const k = median(known), g = median(ghost);

  r.ok("an unknown email returns the same message as a real one",
    (await attempt(page, GHOST_EMAIL, "wrong-password")).error === SHARED_ERROR);
  // The regression this catches is a return-early that skips bcrypt entirely,
  // which shows up as a ratio near zero, not as a few percent of noise. The
  // bound is deliberately loose: a tight one would fail on a busy machine and
  // teach us to ignore it.
  r.ok("an unknown email still pays for a bcrypt comparison", g > k * 0.4,
    `known ${k}ms · unknown ${g}ms · ratio ${(g / k).toFixed(2)}`);
  r.ok("the ghost account was never created",
    (await db.seller.count({ where: { email: GHOST_EMAIL } })) === 0);
}

/* ---- 5. Password reset says the same thing either way ------------------- */
{
  r.section("password reset is worded identically either way");
  await db.$executeRawUnsafe('DELETE FROM "RateLimit"');
  const confirmations = [];
  for (let i = 0; i < 5; i++) {
    await page.goto(url("/forgot"), { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', REAL_EMAIL);
    await page.click('button[type="submit"]');
    // The form is replaced by the confirmation panel, so wait for the field to
    // go rather than for text that must not differ between the two cases.
    await page.waitForSelector('input[name="email"]', { state: "detached", timeout: 15000 })
      .catch(() => null);
    confirmations.push((await page.locator("body").innerText()).trim());
  }
  // Requests 4 and 5 are over the 3-per-hour email limit. They must read the
  // same as the first three: a vendor who mistypes twice should never learn
  // more about the system than one who did not.
  r.ok("a throttled reset request is worded identically to an accepted one",
    new Set(confirmations).size === 1,
    `${new Set(confirmations).size} distinct screens`);
  r.ok("the reset screen never mentions a limit",
    !/too many|limit|blocked|later/i.test(confirmations[4]));
  await screenshot(page, "auth-rate-limit-reset");
}

/* ---- 6. Rotating IPs does not defeat the email limit -------------------- */
{
  r.section("rotating IPs does not defeat the email limit");
  await db.$executeRawUnsafe('DELETE FROM "RateLimit"');
  for (let i = 0; i < 5; i++) {
    // A fresh forwarded address on every request — the shape of a credential
    // stuffing run behind a proxy pool. The email dimension is what stops it.
    await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${i + 1}` });
    await attempt(page, REAL_EMAIL, "wrong-password");
  }
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.200" });
  const sixth = await attempt(page, REAL_EMAIL, REAL_PASSWORD);
  r.ok("the email limit holds even from a new address each time",
    !sixth.url.includes("/dashboard"), sixth.url);
  r.ok("and it still says only the shared message", sixth.error === SHARED_ERROR);
  await context.setExtraHTTPHeaders({});
}

/* ---- cleanup ------------------------------------------------------------ */
await db.$executeRawUnsafe('DELETE FROM "RateLimit"');
await db.seller.deleteMany({ where: { email: { in: [REAL_EMAIL, GHOST_EMAIL] } } });
const okAll = r.report();
await db.$disconnect();
await browser.close();
process.exit(okAll ? 0 : 1);
