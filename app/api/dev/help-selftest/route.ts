import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { HELP_ARTICLES } from "@/lib/help/content";
import {
  availableArticles,
  articleBySlug,
  articlesForRoute,
  hasCapability,
  relatedArticles,
  searchHelp,
} from "@/lib/help/search";
import { CATEGORY_ORDER, CATEGORY_LABELS, bodyText } from "@/lib/help/types";
import { NO_CAPABILITIES, type GuidanceCapabilities } from "@/lib/guidance";
import { HELP_SHOTS, isIllustrated, shot } from "@/lib/help/screenshots";

/**
 * Help content self-test — "every answer is findable, linked, and true."
 *
 *   curl localhost:3000/api/dev/help-selftest
 *
 * Pure: no database, no network, writes nothing. 404s in production.
 *
 * The properties worth protecting, in order of how badly a regression hurts:
 *
 *   1. NOTHING UNVERIFIED SHIPS. Every article names the code its answer was
 *      checked against, so a change to that code has a mechanical way of
 *      finding the articles it just invalidated.
 *   2. NO BROKEN LINKS. A related-article link to a slug that doesn't exist is
 *      a dead end in the one place a confused vendor went for help.
 *   3. CAPABILITY GATING HOLDS. Walk-up and DropMeet articles never reach a
 *      vendor without those features.
 *   4. SEARCH FINDS THE OBVIOUS THING. Fixtures pin the queries vendors
 *      actually type.
 *   5. RAW QUERIES ARE NEVER LOGGED.
 */

type Result = { name: string; pass: boolean; detail?: string };

const ALL_CAPS: GuidanceCapabilities = { walkUp: true, dropMeet: true, growthFeatures: true };

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  /* ------------------------- 1. Schema integrity ------------------------ */
  check("the corpus is a real help centre, not a stub", HELP_ARTICLES.length >= 40,
    `${HELP_ARTICLES.length} articles`);

  const slugs = HELP_ARTICLES.map((a) => a.slug);
  const ids = HELP_ARTICLES.map((a) => a.id);
  check("slugs are unique", new Set(slugs).size === slugs.length,
    slugs.filter((s, i) => slugs.indexOf(s) !== i).join());
  check("ids are unique", new Set(ids).size === ids.length);
  check("slugs are URL-safe", slugs.every((s) => /^[a-z0-9-]+$/.test(s)),
    slugs.filter((s) => !/^[a-z0-9-]+$/.test(s)).join());

  const missingField = (f: keyof (typeof HELP_ARTICLES)[number]) =>
    HELP_ARTICLES.filter((a) => !a[f] || (Array.isArray(a[f]) && (a[f] as unknown[]).length === 0));
  for (const f of ["title", "question", "summary", "category", "verifiedAgainst"] as const) {
    check(`every article has a ${f}`, missingField(f).length === 0,
      missingField(f).map((a) => a.slug).join());
  }
  check("every article has keywords", missingField("keywords").length === 0);
  check("every article has body content",
    HELP_ARTICLES.every((a) => a.body.length > 0));
  check("every category is one the panel renders",
    HELP_ARTICLES.every((a) => CATEGORY_ORDER.includes(a.category)));
  check("every category has at least one article",
    CATEGORY_ORDER.every((c) => HELP_ARTICLES.some((a) => a.category === c)),
    CATEGORY_ORDER.filter((c) => !HELP_ARTICLES.some((a) => a.category === c)).join());
  check("every category has a label", CATEGORY_ORDER.every((c) => !!CATEGORY_LABELS[c]));

  /* -------------------------- 2. verifiedAgainst ------------------------ */
  check("verifiedAgainst names real files",
    HELP_ARTICLES.every((a) => /\.(tsx|ts|prisma)\b/.test(a.verifiedAgainst)),
    HELP_ARTICLES.filter((a) => !/\.(tsx|ts|prisma)\b/.test(a.verifiedAgainst))
      .map((a) => a.slug).join());
  {
    // Spot-check that the named files exist. A rename should surface here.
    const files = new Set<string>();
    for (const a of HELP_ARTICLES) {
      for (const m of a.verifiedAgainst.matchAll(/([\w./[\]-]+\.(?:tsx|ts|prisma))(?![\w])/g)) {
        files.add(m[1]);
      }
    }
    const missing = [...files].filter((f) => {
      try { readFileSync(f, "utf8"); return false; } catch { return true; }
    });
    check(`every file named by verifiedAgainst exists (${files.size} files)`,
      missing.length === 0, missing.join(", "));
  }

  /* ----------------------- 3. Links and route maps ---------------------- */
  {
    const bad: string[] = [];
    for (const a of HELP_ARTICLES) {
      for (const s of a.related) if (!articleBySlug(s)) bad.push(`${a.slug} -> ${s}`);
    }
    check("every related link resolves", bad.length === 0, bad.join(", "));
    check("no article lists itself as related",
      HELP_ARTICLES.every((a) => !a.related.includes(a.slug)));
  }
  {
    const KNOWN = [
      "/dashboard", "/dashboard/drops", "/dashboard/drops/new", "/dashboard/products",
      "/dashboard/orders", "/dashboard/payments", "/dashboard/customers",
      "/dashboard/messages", "/dashboard/store", "/dashboard/billing",
      "/dashboard/where-ill-be", "/dashboard/discoverability",
    ];
    const bad = HELP_ARTICLES.flatMap((a) =>
      (a.routes ?? []).filter((rt) => !KNOWN.includes(rt)).map((rt) => `${a.slug}:${rt}`)
    );
    check("every route mapping is a real dashboard route", bad.length === 0, bad.join(", "));
  }

  /* ------------------------- 4. Capability gating ----------------------- */
  {
    const none = availableArticles(NO_CAPABILITIES);
    check("walk-up articles are hidden without the capability",
      !none.some((a) => a.requires === "walkup"));
    check("DropMeet articles are hidden without a live region",
      !none.some((a) => a.requires === "dropmeet"));
    check("walk-up articles appear when the capability is on",
      availableArticles(ALL_CAPS).some((a) => a.requires === "walkup"));
    check("gated articles are a minority — most help is universal",
      none.length >= HELP_ARTICLES.length - 8, `${none.length}/${HELP_ARTICLES.length}`);
    check("no ungated article mentions walk-up",
      none.every((a) => !/walk[- ]up/i.test(`${a.title} ${a.summary} ${bodyText(a.body)}`)),
      none.filter((a) => /walk[- ]up/i.test(a.summary)).map((a) => a.slug).join());
    check("related links from a gated article are filtered for the reader",
      relatedArticles(articleBySlug("walkup-which-qr")!, NO_CAPABILITIES)
        .every((a) => !a.requires));
    check("hasCapability maps each requirement to its own gate",
      hasCapability("walkup", ALL_CAPS) && !hasCapability("walkup", NO_CAPABILITIES) &&
      hasCapability("dropmeet", ALL_CAPS) && !hasCapability("dropmeet", NO_CAPABILITIES));
  }

  /* ----------------------------- 5. Search ------------------------------ */
  {
    const top = (q: string, caps = ALL_CAPS, path?: string) =>
      searchHelp(q, caps, path)[0]?.article.slug ?? "none";

    const FIXTURES: Array<[string, string[]]> = [
      ["stripe", ["connect-stripe", "do-i-need-stripe", "stripe-started-vs-ready"]],
      ["qr", ["drop-qr-code", "share-your-drop", "where-to-put-qr"]],
      ["can't publish", ["why-cant-i-publish"]],
      ["cant publish", ["why-cant-i-publish"]],
      ["when do I get paid", ["when-do-i-get-paid"]],
      ["fees", ["what-dropq-charges"]],
      ["inventory", ["how-inventory-works", "change-inventory"]],
      ["how many drops", ["plans-and-limits", "starter-drop-limit"]],
      ["sold out", ["sold-out"]],
      ["followers", ["customers-vs-followers"]],
      ["relaunch", ["relaunch-a-drop"]],
      ["dates", ["how-drop-dates-work"]],
    ];
    for (const [q, expected] of FIXTURES) {
      const got = top(q);
      check(`search "${q}" surfaces the right article`, expected.includes(got), `got ${got}`);
    }

    check("search finds nothing for nonsense",
      searchHelp("zzzqqxx", ALL_CAPS).length === 0);
    check("an empty query returns nothing rather than everything",
      searchHelp("   ", ALL_CAPS).length === 0);
    check("search never returns a gated article to a vendor without it",
      searchHelp("walk up", NO_CAPABILITIES).every((x) => !x.article.requires));
    check("results are ordered by score",
      (() => {
        const rs = searchHelp("stripe", ALL_CAPS);
        return rs.every((x, i) => i === 0 || rs[i - 1].score >= x.score);
      })());
    check("the current page nudges ranking without filtering",
      searchHelp("drop", ALL_CAPS, "/dashboard/drops/new").length ===
        searchHelp("drop", ALL_CAPS).length);
  }

  /* -------------------------- 6. Contextual help ------------------------ */
  {
    const on = (path: string) => articlesForRoute(path, ALL_CAPS).map((a) => a.slug);
    check("the drop editor suggests drop-type, dates and items",
      ["drop-types", "how-drop-dates-work", "add-items"].every((s) =>
        on("/dashboard/drops/new").includes(s)),
      on("/dashboard/drops/new").join());
    check("payments suggests Stripe setup",
      on("/dashboard/payments").includes("connect-stripe"));
    check("orders suggests managing orders",
      on("/dashboard/orders").includes("where-are-my-orders"));
    check("a drop's own page suggests sharing",
      on("/dashboard/drops").includes("share-your-drop"));
    check("contextual help never returns a gated article",
      articlesForRoute("/dashboard/where-ill-be", NO_CAPABILITIES).every((a) => !a.requires));
    check("an unmapped route simply has no suggestions",
      articlesForRoute("/dashboard/analytics", ALL_CAPS).length === 0);
  }

  /* ------------------------ 7. Established truths ----------------------- */
  {
    const text = (slug: string) => {
      const a = articleBySlug(slug)!;
      return `${a.title} ${a.summary} ${bodyText(a.body)}`;
    };
    check("Stripe: started is distinguished from charge-ready",
      /not the same as being able to take money/i.test(text("stripe-started-vs-ready")));
    check("payments: the vendor is the merchant of record",
      /merchant of record/i.test(text("what-dropq-charges")));
    check("drop mode is documented as fixed after creation",
      /cannot be changed after a drop is created/i.test(text("drop-types")));
    check("the Free allowance is documented as lifetime",
      /lifetime/i.test(text("plans-and-limits")));
    check("deleting is documented as not refunding a slot",
      /does not give the slot back/i.test(text("starter-drop-limit")));
    check("relaunch is documented as spending another drop",
      /spends another slot/i.test(text("starter-drop-limit")));
    check("the QR is documented as per drop",
      /own QR code/i.test(text("drop-qr-code")));
    check("no store-level QR is claimed",
      /no single store-wide or account-wide/i.test(text("drop-qr-code")));
    check("followers are documented as not messageable",
      /does not give you a follower list/i.test(text("customers-vs-followers")));
    check("Discovery is documented as off by default",
      /does not appear there until you switch Discovery on/i.test(text("discovery-settings")));
    check("email verification is documented as not gating selling",
      /does not gate anything/i.test(text("verify-your-email")));
    check("restarting the tour is documented as not resetting progress",
      /doesn't reset your checklist/i.test(text("restart-the-tour")));
    check("no article claims DropQ handles cash",
      HELP_ARTICLES.every((a) => !/we (take|handle) cash|cash payments are/i.test(bodyText(a.body))));
  }

  /* ------------------------- 8. Privacy source pins --------------------- */
  {
    const panel = readFileSync("components/help/panel.tsx", "utf8");
    check("the panel never passes a raw query to analytics",
      /help_searched/.test(panel) && !/query:\s*query/.test(panel) &&
        !/query:\s*q\b/.test(panel));
    check("the panel reports only the shape of a search",
      /queryLength/.test(panel) && /resultCount/.test(panel) && /zeroResults/.test(panel));
    const search = readFileSync("lib/help/search.ts", "utf8");
    check("the search module logs nothing at all",
      !/console\.|track|analytics/i.test(search.replace(/\/\*[\s\S]*?\*\//g, "")));
    const analytics = readFileSync("lib/analytics.ts", "utf8");
    const shape = analytics.match(/help_searched:\s*\{([^}]*)\}/)?.[1] ?? "";
    check("the event type still forbids a query field",
      shape.length > 0 && !/\bquery\b\s*:/.test(shape), shape.trim());
  }

  /* --------------------------- 9. Help surfaces ------------------------- */
  {
    const layout = readFileSync("app/dashboard/layout.tsx", "utf8");
    check("Help is mounted in the dashboard", /<HelpHost/.test(layout));
    check("the temporary sidebar tour button is gone",
      !/TourRestartButton/.test(layout));
    const mobile = readFileSync("components/mobile-nav.tsx", "utf8");
    check("the mobile menu opens the same panel", /openHelp\(\)/.test(mobile));
    const panel = readFileSync("components/help/panel.tsx", "utf8");
    check("the tour restart lives in Help now", /startTourAction/.test(panel));
    check("Help links out to the full help centre", /href="\/help"/.test(panel));
    const footer = readFileSync("components/site-footer.tsx", "utf8");
    check("the footer's Help center link is no longer dead",
      /\["Help center", "\/help"\]/.test(footer));
  }

  /* ---------------------- 10. Visual documentation ---------------------- */
  {
    // Every property that makes a screenshot trustworthy: it exists on disk, it
    // matches the bytes that were captured, it was taken from the docs seed and
    // not from production, and no article points at an image that isn't there.
    const shots = HELP_SHOTS;
    check("screenshots were generated", shots.length >= 15, `${shots.length} shots`);

    const shotIds = shots.map((s) => s.id);
    check("screenshot ids are unique", new Set(shotIds).size === shotIds.length,
      shotIds.filter((s, i) => shotIds.indexOf(s) !== i).join());

    check("every screenshot belongs to a real article",
      shots.every((s) => articleBySlug(s.article)),
      shots.filter((s) => !articleBySlug(s.article)).map((s) => s.id).join());

    check("every screenshot file exists",
      shots.every((s) => existsSync(`public${s.file}`)),
      shots.filter((s) => !existsSync(`public${s.file}`)).map((s) => s.file).join());

    // The manifest records a 16-char prefix, which is plenty to catch a file
    // edited or replaced by hand without regenerating.
    const digest = (s: { file: string }) =>
      createHash("sha256").update(readFileSync(`public${s.file}`)).digest("hex").slice(0, 16);
    check("the files on disk are the files that were captured",
      shots.every((s) => digest(s) === s.sha256),
      shots.filter((s) => digest(s) !== s.sha256).map((s) => s.id).join());

    check("every screenshot has a caption that describes it",
      shots.every((s) => s.caption.trim().length >= 15 && /[.!?]$/.test(s.caption.trim())),
      shots.filter((s) => s.caption.trim().length < 15).map((s) => s.id).join());

    // Shots are viewport-sized, not full-page, so anything the highlight box
    // reports outside width×height was drawn where nobody can see it. This is
    // exactly the smooth-scroll bug that put four markers off-screen.
    const offScreen = (s: (typeof shots)[number]) => {
      const r = s.highlightRect;
      return (
        r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0 || r.x + r.w > s.width || r.y + r.h > s.height
      );
    };
    check("highlights landed on screen", !shots.some(offScreen),
      shots.filter(offScreen).map((s) => `${s.id} y=${Math.round(s.highlightRect.y)}`).join());

    // The one thing a leak would look like: a real name, a real address, a
    // localhost URL shipped as if it were the product.
    const FORBIDDEN = /grandies|britts bunnies|casa makulay|marble ?(&|and) ?crumb|localhost|127\.0\.0\.1/i;
    check("no screenshot metadata names a real vendor or a dev origin",
      !FORBIDDEN.test(JSON.stringify(shots)),
      JSON.stringify(shots).match(FORBIDDEN)?.[0]);

    // Articles → shots. A `walk` step naming an id that was never captured
    // renders a step with no picture, which is worse than no walkthrough.
    const referenced: string[] = [];
    for (const a of HELP_ARTICLES) {
      for (const b of a.body) {
        if (b.kind !== "walk") continue;
        for (const step of b.items) {
          if (!step.shot) continue;
          referenced.push(step.shot);
          check(`${a.slug} → ${step.shot} exists`, Boolean(shot(step.shot)));
          check(`${a.slug} → ${step.shot} belongs to it`, shot(step.shot)?.article === a.slug,
            shot(step.shot)?.article);
        }
      }
    }
    check("every captured screenshot is actually used",
      shots.every((s) => referenced.includes(s.id)),
      shots.filter((s) => !referenced.includes(s.id)).map((s) => s.id).join());

    const illustrated = HELP_ARTICLES.filter((a) => a.body.some((b) => b.kind === "walk"));
    check("six articles are illustrated", illustrated.length === 6,
      illustrated.map((a) => a.slug).join());
    check("illustrated articles let the picture teach",
      illustrated.every((a) =>
        a.body.every((b) =>
          b.kind !== "walk" || b.items.every((i) => i.text.length <= 260 && i.title.length <= 60)
        )
      ));
    check("isIllustrated agrees with the corpus",
      illustrated.every((a) => isIllustrated(a.slug)) &&
        HELP_ARTICLES.filter((a) => !illustrated.includes(a)).every((a) => !isIllustrated(a.slug)));

    // The capture runner must stay unable to point at anything but the local
    // throwaway database.
    const capture = readFileSync("tests/browser/docs/capture.mjs", "utf8");
    check("the screenshot runner goes through the production guard",
      /assertVerifyDatabase|support\/guard\.mjs/.test(capture));
    check("the screenshot runner scans its own output for secrets",
      /SECRET_PATTERNS/.test(capture));
    const seed = readFileSync("tests/browser/seed/docs-vendor.mjs", "utf8");
    check("the documentation vendor is fictional and uses a reserved domain",
      /\.example\.com/.test(seed) && !FORBIDDEN.test(seed));
  }

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);
  return NextResponse.json(
    {
      suite: "help",
      articles: HELP_ARTICLES.length,
      screenshots: HELP_SHOTS.length,
      passed,
      failed: failures.length,
      results: failures.length ? failures : "all pass",
    },
    { status: failures.length === 0 ? 200 : 500 }
  );
}
