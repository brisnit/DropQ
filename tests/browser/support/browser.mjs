import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { APP_URL } from "./guard.mjs";
import { sessionCookie } from "./session.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOT_DIR = process.env.BROWSER_SHOTS || join(HERE, "..", ".shots");

/**
 * The two viewports every spec runs at.
 *
 * Fixed, not device-emulated presets: a preset that changes with a Playwright
 * upgrade would silently change what "mobile" means and quietly invalidate
 * every docking assertion built on it.
 */
export const VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 900, isMobile: false, hasTouch: false },
};

export async function launch() {
  // The developer's installed Chrome — no 300MB browser download in a repo
  // whose only other devDependencies are types and Tailwind.
  return chromium.launch({ channel: "chrome" });
}

export async function vendorContext(browser, sellerId, viewport, opts = {}) {
  const vp = VIEWPORTS[viewport];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    deviceScaleFactor: 2,
    ...opts,
  });
  await context.addCookies([sessionCookie(sellerId)]);
  // The Next dev-tools button is labelled "Next", which collides with the
  // tour's own Next control, and it sits in the corner of every screenshot.
  await context.addInitScript(() => {
    const hide = () => {
      const s = document.createElement("style");
      s.textContent =
        "[data-nextjs-dev-tools-button],nextjs-portal,#next-logo{display:none !important}";
      document.head?.appendChild(s);
    };
    document.head ? hide() : document.addEventListener("DOMContentLoaded", hide);
  });
  return context;
}

export const url = (path) => `${APP_URL}${path}`;

export async function screenshot(page, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  // Guidance and Help fade in over 140ms. Capturing immediately produces a
  // half-transparent panel that looks like a rendering bug and isn't one.
  // A fixed settle rather than waiting on getAnimations(): the dashboard has a
  // deliberately infinite "live" pulse that would never resolve.
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}

/**
 * Wait until a piece of guidance is INTERACTIVE, not merely painted.
 *
 * Server-rendered markup appears before React hydrates, and the keyboard
 * handlers (Escape, arrows) are attached by an effect. `networkidle` does not
 * imply hydration, so a spec that presses Escape straight after `goto` can
 * race the listener and see nothing happen.
 *
 * Focus landing on the element is the signal: the same effect that focuses it
 * is the one that registers the handlers.
 */
export async function guidanceReady(page, role = "dialog") {
  const el = page.locator(`[role="${role}"]`);
  await el.waitFor({ state: "visible", timeout: 15_000 });
  // Hydration attaches the keyboard handlers; a button inside becoming
  // actionable is the cheapest proxy for "React has taken over this markup".
  await el.getByRole("button").first().waitFor({ state: "visible", timeout: 15_000 });
  return el;
}

/**
 * Has focus landed inside the guidance element?
 *
 * Reported rather than awaited: focus is an accessibility property worth
 * asserting, but a spec that blocks on it turns an a11y regression into a
 * 30-second timeout with no useful message.
 */
export async function focusLanded(page, role, timeout = 4000) {
  try {
    await page.waitForFunction(
      (r) => {
        const el = document.querySelector(`[role="${r}"]`);
        return !!el && (el === document.activeElement || el.contains(document.activeElement));
      },
      role,
      { timeout, polling: 100 }
    );
    return true;
  } catch {
    return false;
  }
}

/** Nothing may be clipped off the side of the page. */
export const noHorizontalOverflow = (page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  );

/** Minimal assertion recorder — same shape as the repo's other self-tests. */
export function recorder(label) {
  let pass = 0;
  const failures = [];
  return {
    ok(name, cond, detail = "") {
      if (cond) {
        pass++;
        console.log(`  ✓ ${name}`);
      } else {
        failures.push(name + (detail ? ` — ${detail}` : ""));
        console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
      }
    },
    section: (t) => console.log(`\n=== ${t} ===`),
    get passed() { return pass; },
    get failures() { return failures; },
    report() {
      console.log(
        `\n${failures.length === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ` +
          `${failures.length} failed  (${label})`
      );
      if (failures.length) {
        console.log("\nISSUES:");
        failures.forEach((f) => console.log(" - " + f));
      }
      return failures.length === 0;
    },
  };
}
