/**
 * Nothing runs off the screen, on the pages a vendor actually uses from a phone.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * This is the third round of "something is cut off on my iPhone" reported from
 * real screenshots. Each round found the same shape of bug in a different
 * place: a row sized for a desktop — fixed-width buttons, a three-across grid,
 * a native date input — inside a container 390px wide. Fixing them one at a
 * time without a test means the fourth round arrives.
 *
 * ── WHAT IT CHECKS, AND WHY TWICE ─────────────────────────────────────────
 *
 * Every page is measured at the default text size and again with the root font
 * at 20px. The reported screenshots came from a phone with iOS text size
 * turned up, and several of these layouts only broke at that size — a check at
 * 16px alone would have passed while the vendor's screen was still wrong.
 *
 * Two distinct failures are caught: an element past the edge of the VIEWPORT,
 * and an element past the edge of its own CARD. The second matters because the
 * page can hide the first — globals.css sets `overflow-x: clip`, so content
 * that escapes is silently cropped rather than scrolling into view.
 *
 * Content inside a deliberate horizontal scroller (the admin nav, a wide
 * table) is skipped: extending past the edge is what those are for.
 */
import prismaModule from "../../../app/generated/prisma/index.js";
import { launch, vendorContext, url, recorder } from "../support/browser.mjs";
import { assertVerifyDatabase } from "../support/guard.mjs";
import { seedFresh, seedSelling, silenceGuidance, openClient } from "../seed/vendor.mjs";
import { readFileSync } from "node:fs";

const DB = assertVerifyDatabase();
const TERMS = readFileSync("lib/terms.ts", "utf8").match(/TERMS_VERSION = "([^"]+)"/)[1];
const r = recorder("mobile-layout");
const browser = await launch();
const db = await openClient(prismaModule, DB);

const seller = await seedFresh(prismaModule, DB, TERMS);
await seedSelling(prismaModule, DB);
await silenceGuidance(prismaModule, DB, seller.id);
await db.seller.update({
  where: { id: seller.id },
  data: { isAdmin: true, stripeAccountId: "acct_layout_test", stripeChargesEnabled: true },
});
// Library rows with realistic long names — the product list broke on exactly
// this, squeezing the name to nothing and pushing Delete off the card.
for (const [name, emoji] of [["Brown Butter Chocolate Chunk", "🍪"], ["Vanilla Bean Cupcake", "🧁"]]) {
  await db.vendorProduct.create({
    data: { sellerId: seller.id, name, emoji, category: "food", priceCents: 1400,
            allergens: "Contains wheat, dairy, egg" },
  });
}

/** Every page in a screenshot report, plus the ones sharing their components. */
const PAGES = [
  "/dashboard",
  "/dashboard/drops",
  "/dashboard/products",
  "/dashboard/payments",
  "/dashboard/where-ill-be",
  "/dashboard/orders",
  "/dashboard/customers",
  "/admin",
  "/admin/commissions",
  "/admin/activation",
];

async function offenders(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const found = [];
    const add = (el, why) => {
      if (!found.some((f) => f.el.contains(el) || el.contains(f.el))) found.push({ el, why });
    };
    const inScroller = (el) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
        p = p.parentElement;
      }
      return false;
    };
    for (const el of document.querySelectorAll("body *")) {
      const b = el.getBoundingClientRect();
      if (!b.width || getComputedStyle(el).position === "fixed" || inScroller(el)) continue;
      if (b.right > vw + 1) add(el, "past the screen");
    }
    for (const card of document.querySelectorAll(".rounded-card")) {
      const cb = card.getBoundingClientRect();
      for (const el of card.querySelectorAll("*")) {
        const b = el.getBoundingClientRect();
        if (b.width && !inScroller(el) && b.right > cb.right + 1) add(el, "outside its card");
      }
    }
    return {
      scroll: document.documentElement.scrollWidth,
      vw,
      list: found.slice(0, 3).map((f) =>
        `${f.why}: <${f.el.tagName.toLowerCase()}> "${(f.el.textContent || "").trim().slice(0, 30)}"`),
    };
  });
}

for (const fontPx of [16, 20]) {
  r.section(fontPx === 16 ? "default text size" : "enlarged text (iOS text size turned up)");
  for (const width of [390, 375]) {
    const ctx = await vendorContext(browser, seller.id, "mobile");
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height: 844 });

    for (const path of PAGES) {
      await page.goto(url(path), { waitUntil: "networkidle" });
      await page.evaluate((px) => { document.documentElement.style.fontSize = `${px}px`; }, fontPx);
      await page.waitForTimeout(220);
      const o = await offenders(page);
      r.ok(`${path} @${width}px`, o.scroll <= o.vw && o.list.length === 0,
        [o.scroll > o.vw ? `scrollWidth ${o.scroll} > ${o.vw}` : "", ...o.list].filter(Boolean).join(" | "));
    }
    await ctx.close();
  }
}

/* ---- The specific regressions, named so a failure says what broke -------- */
r.section("the reported cases");
{
  const ctx = await vendorContext(browser, seller.id, "mobile");
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });

  // Native date/time inputs carry an intrinsic minimum width in Safari that
  // `w-full` cannot override; without min-width:0 they push their row open.
  await page.goto(url("/dashboard/where-ill-be"), { waitUntil: "networkidle" });
  const shrinkable = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="date"], input[type="time"]')]
      .map((el) => getComputedStyle(el).minWidth));
  r.ok("every date and time input can shrink to its column",
    shrinkable.length > 0 && shrinkable.every((m) => m === "0px"), shrinkable.join(", "));

  // Money must never be broken mid-number to make it fit.
  await page.goto(url("/dashboard/payments"), { waitUntil: "networkidle" });
  await page.evaluate(() => { document.documentElement.style.fontSize = "20px"; });
  await page.waitForTimeout(250);
  const split = await page.evaluate(() =>
    [...document.querySelectorAll("p")]
      .filter((p) => /^\$[\d,]+\.?\d*$/.test(p.textContent.trim()))
      .map((p) => ({ text: p.textContent.trim(), lines: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)) })));
  r.ok("a money figure never wraps onto two lines",
    split.length > 0 && split.every((s) => s.lines <= 1),
    split.map((s) => `${s.text}=${s.lines} lines`).join(", "));

  await ctx.close();
}

const okAll = r.report();
await db.$disconnect();
await browser.close();
process.exit(okAll ? 0 : 1);
