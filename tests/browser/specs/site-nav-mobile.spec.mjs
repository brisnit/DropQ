/**
 * The public site's menu on a phone.
 *
 * Below 768px the marketing header used to offer a logo and two buttons and
 * nothing else — DropMeet, Find Drops, How It Works, Features and Pricing
 * were absent, not collapsed. Most people who scan a DropQ QR code land on
 * exactly that header, so the first assertion here is the plain one: every
 * link a desktop visitor gets, a phone visitor can reach too.
 *
 * Read-only: the public site needs no fixtures.
 */
import prismaModule from "../../../app/generated/prisma/index.js";
import { launch, url, screenshot, recorder, vendorContext } from "../support/browser.mjs";
import { assertVerifyDatabase } from "../support/guard.mjs";
import { seedFresh } from "../seed/vendor.mjs";
import { readFileSync } from "node:fs";

const DB = assertVerifyDatabase();
const TERMS = readFileSync("lib/terms.ts", "utf8").match(/TERMS_VERSION = "([^"]+)"/)[1];
const r = recorder("site-nav-mobile");
const browser = await launch();

const EXPECTED = ["DropMeet", "Find Drops", "How It Works", "Features", "Pricing"];

async function phone(width = 390) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}

const menuButton = (page) => page.getByRole("button", { name: /open menu/i });

/* ---- 1. Parity with the desktop header -------------------------------- */
r.section("every desktop link is reachable on a phone");
{
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const dp = await desktop.newPage();
  await dp.goto(url("/"), { waitUntil: "networkidle" });
  const onDesktop = await dp.locator("header nav a").allInnerTexts();
  r.ok("the desktop header still shows its links",
    EXPECTED.every((l) => onDesktop.some((t) => t.trim() === l)), onDesktop.join(" | "));
  r.ok("the menu button is not shown on desktop",
    (await menuButton(dp).count()) === 0 || !(await menuButton(dp).first().isVisible()));
  await desktop.close();

  const { ctx, page, errors } = await phone();
  await page.goto(url("/"), { waitUntil: "networkidle" });
  r.ok("a phone gets a menu button", await menuButton(page).first().isVisible());

  await menuButton(page).first().click();
  await page.waitForTimeout(250);
  const inMenu = await page.locator('[id] a[href]').allInnerTexts();
  for (const label of EXPECTED) {
    r.ok(`"${label}" is reachable from the phone menu`,
      inMenu.some((t) => t.includes(label)));
  }
  r.ok("no page errors", errors.length === 0, errors.join(" | "));
  await screenshot(page, "site-nav-mobile-open");
  await ctx.close();
}

/* ---- 2. It opens, closes, and navigates ------------------------------- */
r.section("behaviour");
{
  const { ctx, page } = await phone();
  await page.goto(url("/"), { waitUntil: "networkidle" });
  const btn = menuButton(page).first();

  r.ok("it starts closed", (await btn.getAttribute("aria-expanded")) === "false");

  await btn.click();
  await page.waitForTimeout(200);
  r.ok("the button reports itself expanded",
    (await page.getByRole("button", { name: /close menu/i }).first().getAttribute("aria-expanded")) === "true");

  // Escape closes it and gives focus back, so a keyboard user is not stranded.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  r.ok("Escape closes it", await btn.isVisible());
  r.ok("and focus returns to the button",
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Open menu"));

  // Tapping outside closes it.
  await btn.click();
  await page.waitForTimeout(200);
  await page.mouse.click(370, 800); // clear of the panel, which is ~320px wide
  await page.waitForTimeout(250);
  r.ok("tapping the page closes it", await btn.isVisible());

  // A link navigates and the menu does not survive the trip.
  await btn.click();
  await page.waitForTimeout(200);
  await page.getByRole("link", { name: /Pricing/ }).first().click();
  await page.waitForURL(/\/pricing/, { timeout: 15000 });
  await page.waitForTimeout(400);
  r.ok("a link navigates", page.url().includes("/pricing"));
  r.ok("and the menu is closed on the new page", await menuButton(page).first().isVisible());
  await ctx.close();
}

/* ---- 3. Thumb-sized, and inside the screen ----------------------------- */
r.section("one-handed");
for (const width of [430, 390, 375, 320]) {
  const { ctx, page } = await phone(width);
  await page.goto(url("/"), { waitUntil: "networkidle" });
  await menuButton(page).first().click();
  await page.waitForTimeout(250);

  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const small = [];
    for (const el of document.querySelectorAll("header button, header a, [role] a")) {
      const b = el.getBoundingClientRect();
      if (b.width && b.height && b.height < 44) small.push(`${(el.textContent || el.getAttribute("aria-label") || "?").trim().slice(0, 18)} ${Math.round(b.height)}px`);
    }
    let overflow = null;
    for (const el of document.querySelectorAll("body *")) {
      const b = el.getBoundingClientRect();
      if (b.width && getComputedStyle(el).position !== "fixed" && b.right > vw + 1) { overflow = el.tagName; break; }
    }
    return { small, overflow, scroll: document.documentElement.scrollWidth, vw };
  });
  r.ok(`@${width}px every control is thumb-sized`, m.small.length === 0, m.small.join(" | "));
  r.ok(`@${width}px the open menu fits the screen`,
    m.overflow === null && m.scroll <= m.vw, `${m.overflow ?? ""} scrollWidth=${m.scroll}`);
  await ctx.close();
}

/* ---- 4. It reaches every page that uses the header --------------------- */
r.section("present across the marketing site");
{
  const { ctx, page } = await phone();
  for (const path of ["/", "/pricing", "/help", "/sell/food", "/sms"]) {
    await page.goto(url(path), { waitUntil: "networkidle" });
    r.ok(`${path} has the menu`, await menuButton(page).first().isVisible().catch(() => false));
  }
  await ctx.close();
}

/* ---- 5. The signed-in header, which is where it broke ----------------- */
r.section("signed in: menu, logo and CTA share one line");
{
  // A signed-in visitor gets "Go to dashboard" instead of two auth links, and
  // that label is wide. With the menu button added and the logo unable to
  // yield, the three collided and the logo ran underneath the pill. Nothing
  // covered this state, so nothing caught it.
  const seller = await seedFresh(prismaModule, DB, TERMS);
  for (const width of [430, 390, 375, 320]) {
    const ctx = await vendorContext(browser, seller.id, "mobile");
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height: 844 });
    await page.goto(url("/"), { waitUntil: "networkidle" });

    const m = await page.evaluate(() => {
      const header = document.querySelector("header");
      const hb = header.getBoundingClientRect();
      const controls = [...header.querySelectorAll("a, button")]
        .filter((e) => e.getBoundingClientRect().width);
      let overlap = null;
      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i].getBoundingClientRect();
          const b = controls[j].getBoundingClientRect();
          if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
          const sameRow = a.top < b.bottom - 2 && b.top < a.bottom - 2;
          if (sameRow && a.left < b.right - 1 && b.left < a.right - 1) {
            overlap = `${label(controls[i])} over ${label(controls[j])}`;
          }
        }
      }
      function label(el) {
        return (el.textContent || el.getAttribute("aria-label") || "?").trim().slice(0, 16);
      }
      return {
        overlap,
        rows: new Set(controls.map((c) => Math.round(c.getBoundingClientRect().top / 8))).size,
        past: controls.filter((c) => c.getBoundingClientRect().right > hb.right + 1).map(label),
      };
    });

    r.ok(`@${width}px nothing in the header overlaps`, m.overlap === null, m.overlap ?? "");
    r.ok(`@${width}px the header stays on one line`, m.rows === 1, `${m.rows} rows`);
    r.ok(`@${width}px nothing is pushed past the edge`, m.past.length === 0, m.past.join(", "));
    await ctx.close();
  }
}

const okAll = r.report();
await browser.close();
process.exit(okAll ? 0 : 1);
