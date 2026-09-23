/**
 * The unlisted vendor demo, at the widths it will actually be seen at.
 *
 * This page has one job: a baker holding their own phone, one-handed, at a
 * market stall, gets to the end. So the assertions are about thumbs and
 * legibility rather than markup — tap targets, no sideways scroll at 375px, a
 * sticky bar that never covers the button it sits on, and a walkthrough that
 * can be finished without reading an instruction.
 *
 * Read-only: the page has no database of its own, so this seeds nothing.
 */
import { launch, url, screenshot, recorder } from "../support/browser.mjs";
import { assertVerifyDatabase } from "../support/guard.mjs";

assertVerifyDatabase();
const r = recorder("vendor-demo");
const browser = await launch();

const PHONE_WIDTHS = [375, 390, 430];

async function phone(width) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // Known and harmless: the Report-Only CSP ignores upgrade-insecure-requests
    // by spec, and Chrome says so on every page in the app.
    if (m.type() === "error" && !/upgrade-insecure-requests/.test(m.text())) errors.push(m.text());
  });
  await page.goto(url("/vendor-demo"), { waitUntil: "networkidle" });
  return { ctx, page, errors };
}

/* ---- 1. It fits, at every width we will hold it at --------------------- */
r.section("fits a phone");
for (const width of PHONE_WIDTHS) {
  const { ctx, page } = await phone(width);
  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const b = el.getBoundingClientRect();
      if (!b.width || getComputedStyle(el).position === "fixed") continue;
      if (b.right > vw + 1 && !bad.some((o) => o.contains(el))) bad.push(el);
    }
    return { scroll: document.documentElement.scrollWidth, vw,
             bad: bad.slice(0, 3).map((e) => `${e.tagName}.${String(e.className).split(" ")[0]}`) };
  });
  r.ok(`@${width}px nothing runs off the screen`,
    overflow.scroll <= overflow.vw && overflow.bad.length === 0,
    `scrollWidth=${overflow.scroll} ${overflow.bad.join(", ")}`);
  await ctx.close();
}

/* ---- 2. One-handed: every control is thumb-sized ----------------------- */
r.section("one-handed");
{
  const { ctx, page } = await phone(375);
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, a[href]")) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;           // hidden
      if (b.height < 44) out.push(`${el.tagName} "${(el.textContent || "").trim().slice(0, 24)}" ${Math.round(b.height)}px`);
    }
    return out;
  });
  r.ok("every visible control is at least 44px tall", small.length === 0, small.join(" | "));

  const cta = page.locator('a[href="#walkthrough"]').first();
  const box = await cta.boundingBox();
  r.ok("the primary CTA spans the width of the screen on a phone",
    box.width > 375 * 0.7, `${Math.round(box.width)}px`);
  await screenshot(page, "vendor-demo-hero");
  await ctx.close();
}

/* ---- 3. The walkthrough can be finished with one thumb ----------------- */
r.section("the walkthrough");
{
  const { ctx, page, errors } = await phone(390);
  await page.locator('a[href="#walkthrough"]').first().click();
  await page.waitForTimeout(600);

  const demo = page.locator("[data-demo]");
  r.ok("the walkthrough is on the page", await demo.count() === 1);

  const advance = demo.locator("button").first();
  const seen = [];
  for (let i = 0; i < 9; i++) {
    const heading = (await demo.locator("[data-demo-heading]").innerText()).trim();
    if (!seen.includes(heading)) seen.push(heading);
    const label = (await advance.innerText()).trim();

    if (label === "Connecting…") { await page.waitForTimeout(1100); continue; }
    if (i === 2) {
      await advance.click();
      await page.waitForTimeout(150);
      r.ok("Stripe shows a connecting state rather than pretending it is instant",
        (await advance.innerText()).trim() === "Connecting…" ||
        (await demo.innerText()).includes("Connecting"));
      await page.waitForTimeout(1200);
      r.ok("then confirms it connected", (await demo.innerText()).includes("Stripe connected"));
      continue;
    }
    await advance.click();
    await page.waitForTimeout(500);
  }

  r.ok("all seven screens were reached", seen.length === 7, `${seen.length}: ${seen.join(" / ")}`);
  r.ok("it reaches the working-drop screen", seen.includes("Your drop is working"));
  r.ok("no page errors during the walkthrough", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ---- 4. Whose screen it is, is never ambiguous ------------------------- */
r.section("perspective");
{
  const { ctx, page } = await phone(390);
  await page.locator('a[href="#walkthrough"]').first().click();
  await page.waitForTimeout(500);
  const demo = page.locator("[data-demo]");
  const advance = demo.locator("button").first();

  const perspectives = [];
  for (let i = 0; i < 8; i++) {
    perspectives.push((await demo.innerText()).split("\n")[0].trim());
    const label = (await advance.innerText()).trim();
    await advance.click();
    await page.waitForTimeout(label === "Connect Stripe" ? 1300 : 450);
  }
  r.ok("the demo says 'what your customers see' when it switches sides",
    perspectives.some((p) => /customers see/i.test(p)), [...new Set(perspectives)].join(" | "));
  r.ok("and says 'your side' for the vendor screens",
    perspectives.some((p) => /your side/i.test(p)));
  await screenshot(page, "vendor-demo-customer");
  await ctx.close();
}

/* ---- 5. The sticky bar never covers the demo's own button -------------- */
r.section("sticky CTA");
{
  const { ctx, page } = await phone(390);
  const sticky = page.locator('a[href="/signup"]').last();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const atTop = await page.evaluate(() => {
    const bar = document.querySelector('div[class*="fixed"][class*="bottom-0"]');
    return bar ? bar.getBoundingClientRect().top < window.innerHeight : false;
  });
  r.ok("the sign-up bar is there when the demo is not", atTop);

  await page.locator("#walkthrough").scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const overlap = await page.evaluate(() => {
    const bar = document.querySelector('div[class*="fixed"][class*="bottom-0"]');
    const btn = document.querySelector("[data-demo] button");
    if (!bar || !btn) return { gone: false, hits: false };
    const bb = bar.getBoundingClientRect(), nb = btn.getBoundingClientRect();
    return {
      gone: bb.top >= window.innerHeight - 1,
      hits: bb.top < nb.bottom && bb.bottom > nb.top && nb.top < window.innerHeight,
    };
  });
  r.ok("it gets out of the way while the demo is on screen", overlap.gone);
  r.ok("so it never covers the demo's advance button", !overlap.hits);
  await ctx.close();
}

/* ---- 6. The ways out ---------------------------------------------------- */
r.section("the ways out");
{
  const { ctx, page } = await phone(390);
  r.ok("signing up is reachable", await page.locator('a[href="/signup"]').count() >= 2);
  r.ok("an existing vendor can sign in", await page.locator('a[href="/login"]').count() >= 1);
  r.ok("'show me again' returns to the walkthrough",
    await page.locator('a[href="#walkthrough"]').count() >= 2);

  const res = await page.request.get(url("/vendor-demo"));
  r.ok("the page asks search engines to stay away",
    /noindex/i.test((await res.text()).match(/<meta name="robots"[^>]*>/i)?.[0] ?? ""),
    (await res.text()).match(/<meta name="robots"[^>]*>/i)?.[0] ?? "no robots meta");
  await ctx.close();
}

/* ---- 7. Desktop keeps the demo phone-shaped ---------------------------- */
r.section("desktop");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url("/vendor-demo"), { waitUntil: "networkidle" });
  const w = await page.locator("[data-demo] [class*='max-w-']").first().boundingBox();
  r.ok("the demo does not stretch across a desktop", w.width <= 420, `${Math.round(w.width)}px`);
  const bar = await page.locator('div[class*="fixed"][class*="bottom-0"]').first().isVisible().catch(() => false);
  r.ok("the sticky phone bar is not shown on desktop", !bar);
  await screenshot(page, "vendor-demo-desktop");
  await ctx.close();
}

const okAll = r.report();
await browser.close();
process.exit(okAll ? 0 : 1);
