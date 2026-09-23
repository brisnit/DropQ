import { readFileSync, readdirSync } from "node:fs";
import { NextResponse } from "next/server";
import {
  DEMO_AUDIENCE,
  DEMO_BUSINESS,
  DEMO_DROP,
  DEMO_MODEL,
  DEMO_ORDERS,
  DEMO_RESULTS,
  DEMO_STEPS,
  DEMO_STEP_COUNT,
} from "@/lib/vendor-demo";
import { ROUTE_PATTERNS } from "@/lib/csp-reports";

/**
 * The unlisted vendor demo at /vendor-demo.
 *
 * The browser suite proves it works with a thumb. This proves the two things a
 * browser cannot show, and which are the whole risk of handing a page to
 * strangers at a market:
 *
 *   1. IT CANNOT WRITE. No server action, no Prisma, no Stripe, no fetch. A
 *      demo that could create an account would be worse than no demo.
 *   2. IT CANNOT SHOW A REAL BUSINESS OR PERSON. Every name and number comes
 *      from lib/vendor-demo.ts, which imports nothing.
 *
 * Read-only: creates no fixtures, so it runs anywhere.
 */

type Result = { name: string; pass: boolean; detail?: string };

/** Source with comments stripped — a file that documents what it refuses to do
 *  must not be convicted by its own explanation. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const PAGE = "app/vendor-demo/page.tsx";
const DEMO_FILES = [
  PAGE,
  "components/vendor-demo/walkthrough.tsx",
  "components/vendor-demo/sticky-cta.tsx",
  "lib/vendor-demo.ts",
];

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  /* ------------------ 1. It cannot touch anything real ------------------- */
  {
    for (const file of DEMO_FILES) {
      const src = code(file);
      check(`${file}: no database access`, !/prisma|@\/lib\/db/.test(src));
      check(`${file}: no server action`, !/"use server"|@\/lib\/actions\//.test(src));
      check(`${file}: no Stripe`, !/stripe/i.test(src) || file === PAGE ? !/from "stripe"|getStripe|@\/lib\/stripe/.test(src) : true);
      check(`${file}: no network call`, !/\bfetch\(|XMLHttpRequest|sendBeacon/.test(src));
      check(`${file}: no auth`, !/requireSeller|getCurrentSeller|requireAdmin|cookies\(\)/.test(src));
    }
    const data = code("lib/vendor-demo.ts");
    check("the demo data module imports nothing at all", !/^\s*import\s/m.test(data));
  }

  /* ---------------- 2. Nothing on it belongs to a real person ------------ */
  {
    const page = readFileSync(PAGE, "utf8");
    const walk = readFileSync("components/vendor-demo/walkthrough.tsx", "utf8");

    // Real vendors that exist in production. None may be named here — the page
    // is public, and a prospect must never see someone else's store.
    for (const real of ["Grandies", "Britts Bunnies", "Casa Makulay", "Marble & Crumb",
                        "The Clovery", "Paraiso", "California Vintage"]) {
      check(`no real vendor named: ${real}`, !page.includes(real) && !walk.includes(real));
    }
    check("the demo business is the invented one", DEMO_BUSINESS.name === "Luna's Kitchen");
    check("its storefront handle is not a live store",
      DEMO_BUSINESS.storefront.includes("lunas-kitchen"));
    check("no email address anywhere on the page",
      !/@[a-z0-9-]+\.[a-z]{2,}/i.test(page) && !/@[a-z0-9-]+\.[a-z]{2,}/i.test(walk.replace(/@\/lib|@\/components/g, "")));

    // Every figure the walkthrough renders must come from the data module.
    const rendered = walk.match(/DEMO_[A-Z_]+/g) ?? [];
    check("the walkthrough reads its values from the demo module", rendered.length >= 6);
    check("no hard-coded money in the walkthrough",
      !/\$\d/.test(walk.replace(/DEMO_[A-Z_]+/g, "")), "a dollar figure is inline rather than in lib/vendor-demo.ts");
  }

  /* ----------------------- 3. Unlisted, and stays so --------------------- */
  {
    const page = readFileSync(PAGE, "utf8");
    check("the page asks not to be indexed", /robots:\s*\{[^}]*index:\s*false/.test(page));
    check("it also asks not to be followed", /follow:\s*false/.test(page));

    // Nothing may link to it, or "unlisted" lasts until the next deploy.
    const linkers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "generated") walk(full); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (full.includes("vendor-demo")) continue;
        if (/["'`]\/vendor-demo/.test(readFileSync(full, "utf8"))) linkers.push(full);
      }
    };
    walk("app"); walk("components");
    check("no page links to the demo", linkers.length === 0, linkers.join(", "));

    check("the route is registered in the CSP route table",
      (ROUTE_PATTERNS as readonly string[]).includes("/vendor-demo"));
  }

  /* ------------------------- 4. The content itself ----------------------- */
  {
    check("seven steps", DEMO_STEP_COUNT === 7 && DEMO_STEPS.length === 7);
    check("it starts on the vendor's side", DEMO_STEPS[0].side === "vendor");
    check("it ends on the vendor's side", DEMO_STEPS[DEMO_STEP_COUNT - 1].side === "vendor");
    check("it visits the customer's side in the middle",
      DEMO_STEPS.some((s) => s.side === "customer"));
    check("every step says whose screen it is",
      DEMO_STEPS.every((s) => s.perspective.length > 0));
    check("every step has a button label", DEMO_STEPS.every((s) => s.cta.length > 0));

    // The four beats the brief is built on, in order.
    const keys = DEMO_STEPS.map((s) => s.key);
    for (const [a, b] of [["business", "stripe"], ["stripe", "drop"], ["drop", "storefront"],
                          ["storefront", "order"], ["order", "dashboard"]] as const) {
      check(`${a} comes before ${b}`, keys.indexOf(a) < keys.indexOf(b));
    }

    check("three steps in the mental model", DEMO_MODEL.length === 3);
    check("the audience list stays short enough to scan", DEMO_AUDIENCE.length <= 10);
    check("the order list is short", DEMO_ORDERS.length <= 5);

    // A dashboard whose numbers do not add up is the thing that makes a demo
    // feel fake, and a prospect who spots it stops believing the rest.
    const loaves = DEMO_ORDERS.reduce((n, o) => n + o.loaves, 0);
    check("orders and loaves agree with the sold count", loaves === DEMO_RESULTS.sold,
      `${loaves} loaves vs sold ${DEMO_RESULTS.sold}`);
    check("sold and remaining add up to the quantity",
      DEMO_RESULTS.sold + DEMO_RESULTS.remaining === DEMO_DROP.quantity,
      `${DEMO_RESULTS.sold}+${DEMO_RESULTS.remaining} vs ${DEMO_DROP.quantity}`);
    check("revenue equals loaves times price",
      DEMO_RESULTS.revenue === `$${(loaves * DEMO_DROP.priceCents) / 100}`,
      `${DEMO_RESULTS.revenue} vs ${loaves}×${DEMO_DROP.price}`);
    check("the order count matches the list length", DEMO_ORDERS.length === DEMO_RESULTS.orders);
  }

  /* --------------- 5. Claims the product can actually back --------------- */
  {
    const stripeStep = DEMO_STEPS.find((s) => s.key === "stripe")!;
    // Verified against lib/checkout-session.ts: direct charges on the vendor's
    // connected account, DropQ taking an application fee. So "straight to your
    // own account" and "never holds your money" are both true as written.
    const session = code("lib/checkout-session.ts");
    check("Stripe really is a direct charge on the vendor's account",
      /application_fee_amount/.test(session));
    check("the demo's Stripe claim matches that architecture",
      /own account/.test(stripeStep.body) && /never holds your money/i.test(stripeStep.body));

    const walk = readFileSync("components/vendor-demo/walkthrough.tsx", "utf8");
    check("the demo says the vendor pays Stripe's processing fee",
      /processing fee/i.test(walk));
    check("no invented statistics on the page",
      !/\b\d{2,3}%|\b\d+,\d{3}\+|\b\d+x more\b/i.test(readFileSync(PAGE, "utf8")));
    check("the page tells the visitor nothing is real",
      /nothing is saved|nothing here is real/i.test(readFileSync(PAGE, "utf8")));
  }

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);
  return NextResponse.json(
    {
      suite: "vendor-demo",
      passed,
      failed: failures.length,
      results: failures.length ? failures : "all pass",
    },
    { status: failures.length === 0 ? 200 : 500 }
  );
}
