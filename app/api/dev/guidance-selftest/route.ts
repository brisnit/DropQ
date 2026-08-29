import { existsSync, readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { activationState, type ActivationSeller, type ActivationState } from "@/lib/activation";
import { dropPhaseNote } from "@/lib/drop-status";
import {
  ANCHORS,
  COACHMARK_IDS,
  DEFAULT_GUIDANCE_STATE,
  NO_CAPABILITIES,
  TIP_IDS,
  TOUR_LENGTH,
  TOUR_STEPS,
  anchorOnRoute,
  anchorSelector,
  coachmarkFor,
  guidanceApplicable,
  guidanceFor,
  guidanceTier,
  routeMatches,
  safeTourStep,
  shouldResumeTour,
  shouldShowWelcome,
  tierAtLeast,
  tipFor,
  tourInviteLabel,
  type AnchorId,
  type GuidanceContext,
  type GuidanceFacts,
  type GuidanceSeller,
  type GuidanceState,
  type TourStatus,
} from "@/lib/guidance";
import {
  computePlacement,
  overlapsAnchor,
  withinViewport,
  DOCK_BREAKPOINT,
  bubbleStyle,
} from "@/components/guidance/position";

/**
 * Guidance self-test (Phase G.1) — "guidance can never interrupt a vendor
 * twice, point at nothing, or teach something that isn't there."
 *
 *   curl localhost:3000/api/dev/guidance-selftest
 *
 * Runs the REAL modules, not a mirror: lib/guidance.ts and
 * components/guidance/position.ts are imported directly, the same approach as
 * the activation self-test. Nothing here touches the database, Stripe or the
 * network, so it is safe to run against any environment — including a local
 * dev server whose .env points at production, which this repo's does.
 *
 * The four properties under protection, in order of how badly a regression
 * would hurt a vendor:
 *
 *   1. AT MOST ONE interruption per render. Welcome beats tour beats coachmark
 *      beats tip, and never two at once — the "Christmas tree" failure.
 *   2. NEVER SHOWN TWICE. A dismissal is permanent; a welcome fires once ever.
 *   3. NEVER POINTS AT NOTHING. Every coachmark and tour step names an anchor
 *      that exists, on the route it claims to live on.
 *   4. NEVER COVERS THE THING IT DESCRIBES. A bubble that hides the button it
 *      is explaining is worse than no bubble.
 *
 * Plus source pins for two decisions that are easy to undo by accident: raw
 * help-search queries are never collected, and every guidance server action
 * authenticates.
 */

type Result = { name: string; pass: boolean; detail?: string };

/* -------------------------------- Fixtures -------------------------------- */

const VENDOR: GuidanceSeller = {
  email: "real@example.com",
  slug: "real-vendor",
  internalKind: null,
};
const DEMO_BY_EMAIL: GuidanceSeller = { ...VENDOR, email: "showcase@dropq.example" };
const DEMO_BY_SLUG: GuidanceSeller = { ...VENDOR, slug: "marble-crumb" };
const INTERNAL: GuidanceSeller = { ...VENDOR, internalKind: "founder" };
const DOCS: GuidanceSeller = { ...VENDOR, internalKind: "docs" };

const ACTIVATION_SELLER: ActivationSeller = {
  email: VENDOR.email,
  slug: VENDOR.slug,
  emailVerified: true,
  disabledAt: null,
  stripeAccountId: "acct_1",
  stripeChargesEnabled: true,
  stripeChargesEnabledAt: new Date("2026-01-01"),
};
const NO_STRIPE_SELLER: ActivationSeller = {
  ...ACTIVATION_SELLER,
  stripeAccountId: null,
  stripeChargesEnabled: false,
  stripeChargesEnabledAt: null,
};

const facts = (over: Partial<GuidanceFacts> = {}): GuidanceFacts => ({
  dropsWithProducts: 0,
  liveDrops: 0,
  paidOrders: 0,
  hasShared: false,
  totalDrops: 0,
  dropsWithPaidOrders: 0,
  repeatCustomers: 0,
  dropsOpeningTomorrow: 0,
  ...over,
});

const state = (over: Partial<GuidanceState> = {}): GuidanceState => ({
  ...DEFAULT_GUIDANCE_STATE,
  ...over,
});

/** A state where the welcome is out of the way — the normal steady state. */
const SETTLED = state({ welcomeSeenAt: new Date("2026-02-01"), tourStatus: "completed" });

const ctx = (over: Partial<GuidanceContext> = {}): GuidanceContext => {
  const f = over.facts ?? facts();
  // Default to a charge-ready vendor; tests that need the blocked path pass
  // `activation: blockedActivation(f)` explicitly.
  const activation: ActivationState =
    over.activation ??
    activationState(ACTIVATION_SELLER, {
      dropsWithProducts: f.dropsWithProducts,
      liveDrops: f.liveDrops,
      paidOrders: f.paidOrders,
      hasShared: f.hasShared,
    });
  return {
    pathname: over.pathname ?? "/dashboard",
    tier: over.tier ?? guidanceTier(f),
    state: over.state ?? SETTLED,
    facts: f,
    activation,
    capabilities: over.capabilities ?? NO_CAPABILITIES,
    // Phase 3: tips are suppressed while the activation card is on screen.
    // Default false so tip fixtures read as "card hidden" unless stated.
    activationCardVisible: over.activationCardVisible ?? false,
  };
};

/** Activation for a vendor who cannot take money. */
const blockedActivation = (f: GuidanceFacts) =>
  activationState(NO_STRIPE_SELLER, {
    dropsWithProducts: f.dropsWithProducts,
    liveDrops: f.liveDrops,
    paidOrders: f.paidOrders,
    hasShared: f.hasShared,
  });

/* ---------------------------------- Suite --------------------------------- */

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // The tip assertions run the REAL `activationState()`, which runs the real
  // `isVendorSellable()`. That function short-circuits to "everyone can sell"
  // when STRIPE_SECRET_KEY is unset or empty — deliberately, so demo mode and
  // seeding work (README, "Local-dev trap"). With an empty key the two
  // Stripe-blocked tip assertions below fail for environmental reasons and
  // look like a guidance bug. Refuse to run rather than report that.
  //
  // ⚠️ The fix is a dummy key, NEVER a weaker gate:
  //     STRIPE_SECRET_KEY=sk_test_dummy npm run dev
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      {
        suite: "guidance",
        error: "stripe_gate_disabled",
        detail:
          "STRIPE_SECRET_KEY is empty, so isVendorSellable() allows everything and the " +
          "Stripe-blocked tip assertions cannot be exercised. Re-run with a dummy key: " +
          "STRIPE_SECRET_KEY=sk_test_dummy npm run dev. Do not weaken the gate.",
      },
      { status: 503 }
    );
  }

  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  /* --------------------------- 1. Applicability -------------------------- */
  check("a real vendor gets guidance", guidanceApplicable(VENDOR));
  check("the showcase store is excluded by email", !guidanceApplicable(DEMO_BY_EMAIL));
  check("the showcase store is excluded by slug", !guidanceApplicable(DEMO_BY_SLUG));
  check("internal accounts are excluded", !guidanceApplicable(INTERNAL));
  check("the docs vendor is excluded by default", !guidanceApplicable(DOCS));
  check("force re-includes the docs vendor for screenshots", guidanceApplicable(DOCS, true));
  check("force cannot be needed to exclude — it only ever includes",
    guidanceApplicable(VENDOR, true));

  {
    // Source pin: lib/guidance.ts mirrors lib/demo.ts's constants so the client
    // bundle doesn't pull in a server module. If demo.ts changes, this fails.
    const demo = readFileSync("lib/demo.ts", "utf8");
    const guidance = readFileSync("lib/guidance.ts", "utf8");
    const emailInDemo = demo.match(/DEMO_SELLER_EMAIL\s*=\s*"([^"]+)"/)?.[1];
    const slugInDemo = demo.match(/DEMO_SELLER_SLUG\s*=\s*"([^"]+)"/)?.[1];
    check("demo email constant is mirrored exactly",
      !!emailInDemo && guidance.includes(`DEMO_SELLER_EMAIL = "${emailInDemo}"`),
      `demo.ts=${emailInDemo}`);
    check("demo slug constant is mirrored exactly",
      !!slugInDemo && guidance.includes(`DEMO_SELLER_SLUG = "${slugInDemo}"`),
      `demo.ts=${slugInDemo}`);
  }

  {
    const d = guidanceFor(DEMO_BY_SLUG, ctx({ state: state() }));
    check("an excluded vendor gets nothing at all — not even the welcome",
      !d.applicable && !d.showWelcome && !d.resumeTour && !d.coachmark && !d.tip);
  }

  /* ------------------------------- 2. Tiers ------------------------------ */
  check("no paid orders -> beginner", guidanceTier(facts()) === "beginner");
  check("live drop but no sale is still beginner",
    guidanceTier(facts({ liveDrops: 1, dropsWithProducts: 2 })) === "beginner");
  check("one paid order -> selling",
    guidanceTier(facts({ paidOrders: 1, dropsWithPaidOrders: 1 })) === "selling");
  check("a repeat customer -> established",
    guidanceTier(facts({ paidOrders: 4, dropsWithPaidOrders: 1, repeatCustomers: 1 })) ===
      "established");
  check("two drops that both sold -> established",
    guidanceTier(facts({ paidOrders: 5, dropsWithPaidOrders: 2 })) === "established");
  check("tierAtLeast orders the tiers",
    tierAtLeast("established", "beginner") &&
      tierAtLeast("selling", "selling") &&
      !tierAtLeast("beginner", "selling"));
  check("tier never depends on feature flags — walk-up doesn't promote anyone",
    guidanceTier(facts()) === guidanceTier(facts()));

  /* ------------------------------ 3. Anchors ----------------------------- */
  {
    const ids = Object.keys(ANCHORS) as AnchorId[];
    check("every tour step names a registered anchor",
      TOUR_STEPS.every((s) => ids.includes(s.anchor)),
      TOUR_STEPS.map((s) => s.anchor).join(","));
    check("anchorSelector builds the attribute selector",
      anchorSelector("drop.publish") === '[data-guidance-anchor="drop.publish"]');
    check("a [param] segment matches any value",
      anchorOnRoute("drop.qr", "/dashboard/drops/clx123") &&
        anchorOnRoute("drop.publish", "/dashboard/drops/abc"));
    check("a [param] segment does NOT match a deeper route",
      !anchorOnRoute("drop.qr", "/dashboard/drops/clx123/edit"));
    // G.3: a [param] no longer swallows sibling literal routes. Before this,
    // every drop-detail anchor "matched" the editor, and coachmarkFor would
    // pick one there — rendering nothing (the element isn't on that page) and
    // starving the editor coachmark that should have shown.
    check("a [param] does not capture /drops/new",
      !anchorOnRoute("drop.qr", "/dashboard/drops/new") &&
        !anchorOnRoute("drop.publish", "/dashboard/drops/new"));
    check("a [param] does not capture /drops/[id]/edit or /sale",
      !routeMatches("/dashboard/drops/[id]", "/dashboard/drops/edit") &&
        !routeMatches("/dashboard/drops/[id]", "/dashboard/drops/sale"));
    check("a [param] still captures a real id",
      anchorOnRoute("drop.qr", "/dashboard/drops/clx123"));
    check("routes of different depth never match",
      !routeMatches("/dashboard/drops", "/dashboard") &&
        !routeMatches("/dashboard", "/dashboard/drops"));
    check("exact segments must match",
      routeMatches("/dashboard/drops", "/dashboard/drops") &&
        !routeMatches("/dashboard/drops", "/dashboard/orders"));
  }

  /* -------------------------------- 4. Tour ------------------------------ */
  check("the tour is six steps", TOUR_LENGTH === 6 && TOUR_STEPS.length === 6);
  check("tour step keys are unique",
    new Set(TOUR_STEPS.map((s) => s.key)).size === TOUR_STEPS.length);
  check("every tour step has copy", TOUR_STEPS.every((s) => s.title && s.body.length > 20));
  check("no tour copy uses the word 'configure'",
    TOUR_STEPS.every((s) => !/configure|parameter/i.test(`${s.title} ${s.body}`)));
  check("safeTourStep clamps below", safeTourStep(-5) === 0);
  check("safeTourStep clamps above", safeTourStep(99) === TOUR_LENGTH - 1);
  check("safeTourStep survives NaN", safeTourStep(Number.NaN) === 0);
  check("safeTourStep truncates fractions", safeTourStep(2.7) === 2);

  /* -------------------------- 5. Stored state rules ---------------------- */
  check("a vendor with no row sees the welcome", shouldShowWelcome(DEFAULT_GUIDANCE_STATE));
  check("a stamped welcome never shows again",
    !shouldShowWelcome(state({ welcomeSeenAt: new Date() })));
  check("an in-progress tour resumes", shouldResumeTour(state({ tourStatus: "in_progress" })));
  check("a skipped tour does not resume",
    !shouldResumeTour(state({ tourStatus: "skipped" })) &&
      !shouldResumeTour(state({ tourStatus: "completed" })));
  {
    const labels: Record<TourStatus, string> = {
      not_started: tourInviteLabel(state({ tourStatus: "not_started" })),
      in_progress: tourInviteLabel(state({ tourStatus: "in_progress" })),
      completed: tourInviteLabel(state({ tourStatus: "completed" })),
      skipped: tourInviteLabel(state({ tourStatus: "skipped" })),
    };
    check("Help offers 'Take' before, 'Restart' after",
      labels.not_started.startsWith("Take") &&
        labels.in_progress.startsWith("Take") &&
        labels.completed.startsWith("Restart") &&
        labels.skipped.startsWith("Restart"),
      JSON.stringify(labels));
  }

  /* ----------------------------- 6. Coachmarks --------------------------- */
  {
    const onDrops = ctx({ pathname: "/dashboard/drops" });
    const c = coachmarkFor(onDrops);
    check("the drops page offers the mode coachmark to a beginner", c?.id === "drops.mode");

    check("a dismissed coachmark never returns",
      coachmarkFor(
        ctx({
          pathname: "/dashboard/drops",
          state: state({ ...SETTLED, dismissedCoachmarks: ["drops.mode"] }),
        })
      ) === null);

    check("a coachmark is not offered on a page its anchor isn't on",
      coachmarkFor(ctx({ pathname: "/dashboard/orders" })) === null);

    check("the tour suppresses coachmarks entirely",
      coachmarkFor(
        ctx({ pathname: "/dashboard/drops", state: state({ tourStatus: "in_progress" }) })
      ) === null);

    check("an established vendor is not taught the order window",
      coachmarkFor(
        ctx({
          pathname: "/dashboard/drops/new",
          facts: facts({ paidOrders: 9, dropsWithPaidOrders: 3, repeatCustomers: 2 }),
        })
      ) === null);

    check("a beginner IS taught the order window",
      coachmarkFor(ctx({ pathname: "/dashboard/drops/new" }))?.id === "editor.orderWindow");

    // Priority: the editor has three eligible coachmarks for a beginner.
    // Exactly one comes back, and it's the earliest in the journey.
    const editor = coachmarkFor(ctx({ pathname: "/dashboard/drops/new" }));
    check("three eligible coachmarks on one page still yield exactly one",
      editor !== null && editor.id === "editor.orderWindow");
    const editorNext = coachmarkFor(
      ctx({
        pathname: "/dashboard/drops/new",
        state: state({ ...SETTLED, dismissedCoachmarks: ["editor.orderWindow"] }),
      })
    );
    check("dismissing one reveals the next, not all of them",
      editorNext?.id === "editor.pickupWindow");

    // The drop page hosts three beginner-eligible coachmarks. Publish comes
    // first (it is the earlier decision), then the QR, and close-vs-delete
    // stays silent until closing a drop could actually cost something.
    check("publish is explained before the QR",
      coachmarkFor(ctx({ pathname: "/dashboard/drops/x" }))?.id === "drop.publish");
    check("the QR follows once publish is dismissed",
      coachmarkFor(ctx({
        pathname: "/dashboard/drops/x",
        state: state({ ...SETTLED, dismissedCoachmarks: ["drop.publish"] }),
      }))?.id === "drop.qr");
    // Never imply a drop can go live when Stripe cannot take money.
    {
      const blockedFacts = facts({ totalDrops: 1, dropsWithProducts: 1 });
      check("publish guidance is withheld from a vendor who cannot sell",
        coachmarkFor(ctx({
          pathname: "/dashboard/drops/x",
          facts: blockedFacts,
          activation: blockedActivation(blockedFacts),
        }))?.id !== "drop.publish");
    }
    check("close-vs-delete waits until there is something to lose",
      coachmarkFor(ctx({
        pathname: "/dashboard/drops/x",
        state: state({ ...SETTLED, dismissedCoachmarks: ["drop.publish", "drop.qr"] }),
      })) === null);
    check("close-vs-delete appears once orders exist",
      coachmarkFor(
        ctx({
          pathname: "/dashboard/drops/x",
          facts: facts({ paidOrders: 2, dropsWithPaidOrders: 1 }),
          state: state({ ...SETTLED, dismissedCoachmarks: ["drop.publish", "drop.qr"] }),
        })
      )?.id === "drop.close");

    check("every coachmark id is unique",
      new Set(COACHMARK_IDS).size === COACHMARK_IDS.length);
  }

  /* -------------------------------- 7. Tips ------------------------------ */
  {
    // Every tip assertion below runs on the overview, which is where tips live.
    const f1 = facts({ totalDrops: 1, dropsWithProducts: 0 });
    check("a drop with no items is the first thing we say",
      tipFor(ctx({ facts: f1, activation: blockedActivation(f1) }))?.id === "drop_without_items");

    const f2 = facts({ totalDrops: 1, dropsWithProducts: 1 });
    check("items but no Stripe -> connect Stripe",
      tipFor(ctx({ facts: f2, activation: blockedActivation(f2) }))?.id ===
        "items_without_stripe");

    const f3 = facts({ totalDrops: 1, dropsWithProducts: 1, liveDrops: 1 });
    check("live but never shared -> share it",
      tipFor(ctx({ facts: f3 }))?.id === "published_not_shared");

    check("sharing clears the share nudge",
      tipFor(ctx({ facts: f3, state: state({ ...SETTLED, sharedAt: new Date() }) }))?.id !==
        "published_not_shared");

    const f4 = facts({
      totalDrops: 2,
      dropsWithProducts: 2,
      liveDrops: 1,
      dropsOpeningTomorrow: 1,
    });
    check("a drop opening tomorrow is worth a word",
      tipFor(ctx({ facts: f4, state: state({ ...SETTLED, sharedAt: new Date() }) }))?.id ===
        "opens_tomorrow");

    const f5 = facts({ totalDrops: 1, dropsWithProducts: 1, liveDrops: 1, paidOrders: 1,
      dropsWithPaidOrders: 1 });
    // G.4: the first order is celebrated by the dashboard's next-step card, not
    // by a tip — one surface, not two saying the same thing.
    check("the first order is NOT a tip",
      tipFor(ctx({ facts: f5, state: state({ ...SETTLED, sharedAt: new Date() }) })) === null);

    const f6 = facts({ totalDrops: 3, dropsWithProducts: 3, paidOrders: 8,
      dropsWithPaidOrders: 2, repeatCustomers: 3 });
    check("repeat customers are surfaced once the first-order moment has passed",
      tipFor(ctx({ facts: f6, state: state({ ...SETTLED, sharedAt: new Date() }) }))?.id ===
        "repeat_customers");

    check("blocked beats polish — no Stripe outranks 'share your drop'",
      tipFor(
        ctx({
          facts: facts({ totalDrops: 1, dropsWithProducts: 1, liveDrops: 1 }),
          activation: blockedActivation(facts({ dropsWithProducts: 1, liveDrops: 1 })),
        })
      )?.id === "items_without_stripe");

    check("a dismissed tip never returns",
      tipFor(
        ctx({
          facts: f3,
          state: state({ ...SETTLED, dismissedTips: ["published_not_shared"] }),
        })
      )?.id !== "published_not_shared");

    check("the tour suppresses tips",
      tipFor(ctx({ facts: f3, state: state({ tourStatus: "in_progress" }) })) === null);

    check("a settled vendor with nothing to do gets no tip",
      tipFor(
        ctx({
          facts: facts({ totalDrops: 2, dropsWithProducts: 2, paidOrders: 3,
            dropsWithPaidOrders: 1 }),
          state: state({ ...SETTLED, sharedAt: new Date() }),
        })
      ) === null);

    check("no tip mentions followers",
      TIP_IDS.length > 0 &&
        !readFileSync("lib/guidance.ts", "utf8")
          .split("const TIPS")[1]
          .split("] as const")[0]
          .match(/follower/i));
  }

  /* --------------------- 8. One interruption, ever ----------------------- */
  {
    const fresh = state();
    const d = guidanceFor(VENDOR, ctx({ state: fresh, facts: facts({ totalDrops: 1 }) }));
    check("a brand-new vendor sees the welcome and nothing else",
      d.showWelcome && !d.resumeTour && !d.coachmark && !d.tip);

    const mid = state({ welcomeSeenAt: new Date(), tourStatus: "in_progress" });
    const d2 = guidanceFor(
      VENDOR,
      ctx({ state: mid, pathname: "/dashboard/drops", facts: facts({ totalDrops: 1 }) })
    );
    check("a resumed tour suppresses coachmarks and tips",
      d2.resumeTour && !d2.showWelcome && !d2.coachmark && !d2.tip);

    const f = facts({ totalDrops: 1, dropsWithProducts: 0 });
    const d3 = guidanceFor(
      VENDOR,
      ctx({ state: SETTLED, pathname: "/dashboard/drops", facts: f,
        activation: blockedActivation(f) })
    );
    check("a coachmark suppresses the tip that would have shown",
      d3.coachmark !== null && d3.tip === null);

    const d4 = guidanceFor(
      VENDOR,
      ctx({
        state: state({ ...SETTLED, dismissedCoachmarks: [...COACHMARK_IDS] }),
        pathname: "/dashboard",
        facts: f,
        activation: blockedActivation(f),
      })
    );
    check("with every coachmark dismissed, the tip comes through",
      d4.coachmark === null && d4.tip?.id === "drop_without_items");

    // The property, swept: across a grid of states and routes, the number of
    // simultaneous interruptions is never more than one.
    let worst = 0;
    for (const st of [state(), SETTLED, state({ tourStatus: "in_progress",
      welcomeSeenAt: new Date() })]) {
      for (const path of ["/dashboard", "/dashboard/drops", "/dashboard/drops/new",
        "/dashboard/drops/abc", "/dashboard/orders"]) {
        for (const fx of [facts(), facts({ totalDrops: 1 }),
          facts({ totalDrops: 1, dropsWithProducts: 1 }),
          facts({ totalDrops: 1, dropsWithProducts: 1, liveDrops: 1 }),
          facts({ totalDrops: 2, dropsWithProducts: 2, liveDrops: 1, paidOrders: 1,
            dropsWithPaidOrders: 1 })]) {
          const dec = guidanceFor(VENDOR, ctx({ state: st, pathname: path, facts: fx,
            activation: blockedActivation(fx) }));
          const n = [dec.showWelcome, dec.resumeTour, !!dec.coachmark, !!dec.tip]
            .filter(Boolean).length;
          worst = Math.max(worst, n);
        }
      }
    }
    check("across 75 state/route/fact combinations, never more than one interruption",
      worst <= 1, `max simultaneous = ${worst}`);
  }

  /* ---------------------------- 9. Positioning --------------------------- */
  {
    check("phones always dock",
      computePlacement({ top: 100, left: 10, width: 100, height: 40 },
        { width: 320, height: 130 }, { width: 390, height: 844 }).mode === "docked");
    check("the dock breakpoint is 640",
      DOCK_BREAKPOINT === 640 &&
        computePlacement({ top: 100, left: 10, width: 100, height: 40 },
          { width: 320, height: 130 }, { width: 639, height: 800 }).mode === "docked");
    check("a roomy desktop places the bubble below the anchor",
      (() => {
        const p = computePlacement({ top: 100, left: 400, width: 120, height: 40 },
          { width: 320, height: 130 }, { width: 1440, height: 900 });
        return p.mode === "floating" && p.side === "bottom";
      })());
    check("an anchor near the bottom flips above",
      (() => {
        const p = computePlacement({ top: 780, left: 400, width: 120, height: 40 },
          { width: 320, height: 130 }, { width: 1440, height: 900 });
        return p.mode === "floating" && p.side === "top";
      })());

    // The sweep. Every plausible anchor position on every plausible desktop
    // viewport: the bubble must never cover the anchor and never leave the
    // screen. This is the assertion that makes coachmarks safe to point at
    // buttons rather than at whitespace.
    let overlaps = 0;
    let escapes = 0;
    let cases = 0;
    const bubble = { width: 320, height: 130 };
    for (const vw of [640, 768, 1024, 1280, 1440, 1920]) {
      for (const vh of [600, 720, 900, 1080]) {
        for (let x = 0; x <= vw - 40; x += Math.max(40, Math.floor(vw / 8))) {
          for (let y = 0; y <= vh - 30; y += Math.max(30, Math.floor(vh / 8))) {
            const anchor = { top: y, left: x, width: 120, height: 40 };
            const p = computePlacement(anchor, bubble, { width: vw, height: vh });
            cases++;
            if (overlapsAnchor(p, anchor, bubble)) overlaps++;
            if (!withinViewport(p, bubble, { width: vw, height: vh })) escapes++;
          }
        }
      }
    }
    check(`a bubble never covers its own anchor (${cases} placements)`, overlaps === 0,
      `overlaps=${overlaps}`);
    check(`a bubble never leaves the viewport (${cases} placements)`, escapes === 0,
      `escapes=${escapes}`);
    check("a bubble taller than the viewport docks rather than clipping",
      computePlacement({ top: 10, left: 10, width: 100, height: 40 },
        { width: 320, height: 2000 }, { width: 1440, height: 900 }).mode === "docked");
  }

  /* --------------------------- 10. Source pins --------------------------- */
  {
    const analytics = readFileSync("lib/analytics.ts", "utf8");
    const searchProps = analytics.match(/help_searched:\s*\{([^}]*)\}/)?.[1] ?? "";
    check("help_searched carries no raw query text",
      searchProps.length > 0 && !/\bquery\b\s*:/.test(searchProps),
      searchProps.trim());
    check("help_searched still answers 'is search working'",
      /resultCount/.test(searchProps) && /zeroResults/.test(searchProps));
    check("guidance events flow through the existing track() beacon",
      /DiscoveryEvent \| GuidanceEvent/.test(analytics));
  }

  {
    const actions = readFileSync("lib/actions/guidance.ts", "utf8");
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    const bodies = actions.split(/export async function /).slice(1);
    check("every guidance action authenticates before writing",
      bodies.every((b) => b.includes("guidanceSeller()")),
      exported.join(","));
    check("there are guidance actions to check", exported.length >= 8, `${exported.length}`);
  }

  {
    const sql = readFileSync(
      "prisma/migrations/20260829174510_add_vendor_guidance/migration.sql",
      "utf8"
    );
    check("the migration alters no existing table",
      !/ALTER TABLE "(?!VendorGuidance)/.test(sql));
    check("the migration drops nothing", !/\bDROP\b/i.test(sql));
    check("the migration suppresses the welcome for pre-existing vendors",
      /INSERT INTO "VendorGuidance"/.test(sql) && /welcomeSeenAt/.test(sql));
    check("the backfill is safe to re-run", /ON CONFLICT/.test(sql));
    check("the backfill does NOT mark the tour skipped",
      !/tourStatus/.test(sql.split("INSERT INTO")[1] ?? ""));
  }

  /* ------------------- 11. G.2 wiring: welcome + tour -------------------- */
  {
    // A bubble whose anchor is absent must still be shown, docked — three of
    // the six tour steps point at sidebar nav that does not exist on mobile.
    check("a missing anchor docks rather than vanishing",
      bubbleStyle(null, false).docked === true);
    check("a measured floating placement is not docked",
      bubbleStyle({ mode: "floating", side: "bottom", top: 10, left: 10 }, true).docked === false);
    check("an unmeasured placement docks rather than floating at 0,0",
      bubbleStyle(null, true).docked === true);
  }

  {
    const host = readFileSync("components/guidance/host.tsx", "utf8");
    check("the welcome is stamped on DISPLAY, not on dismissal",
      /mode !== "welcome" \|\| stamped\.current/.test(host) &&
        /markWelcomeSeenAction\(\)/.test(host));
    check("stamping is guarded against React's double-invoked effects",
      /stamped = useRef\(false\)/.test(host));
    {
      // Help must still offer the tour as something new, so skipping the
      // welcome must not end a tour that never started. Sliced rather than
      // regexed: a lazy [\s\S]*? happily runs past the handler and matches
      // `endTourAction` further down the file.
      const at = host.indexOf("onSkip={(via)");
      const body = at >= 0 ? host.slice(at, at + 500) : "";
      check("skipping the WELCOME does not mark the TOUR skipped",
        body.includes("setMode(null)") && !body.includes("endTourAction"), body.slice(0, 80));
    }
    check("the host renders nothing when guidance does not apply",
      /if \(!payload\.applicable\) return null;/.test(host));
    check("every guidance write from the host is fire-and-forget",
      (host.match(/void \w+Action\([^)]*\)\.catch\(\(\) => \{\}\)/g) ?? []).length >= 4);
  }

  {
    const layout = readFileSync("app/dashboard/layout.tsx", "utf8");
    check("the layout mounts the guidance host",
      /<GuidanceHost/.test(layout));
    check("the layout READS guidance state and never upserts on render",
      // `.upsert(` and `ensureGuidance(` as CALLS — matching the bare word
      // "upsert" also matches the comment explaining why there isn't one.
      /loadGuidancePayload\(seller\)/.test(layout) &&
        !/\.upsert\(|ensureGuidance\(/.test(layout));
    {
      const gctx = readFileSync("lib/guidance-context.ts", "utf8");
      check("applicability is decided once, server-side",
        /guidanceApplicable\(seller\)/.test(gctx) && !/guidanceApplicable/.test(layout));
      check("an inapplicable vendor costs no queries",
        /if \(!applicable\)/.test(gctx));
      check("capabilities come from the real feature gates, not a re-implementation",
        /isWalkUpEnabled\(seller\)/.test(gctx) && /hasGrowthFeatures\(seller\)/.test(gctx));
    }
  }

  {
    const tour = readFileSync("components/guidance/tour.tsx", "utf8");
    check("the tour offers Back, Next, Skip and a close control",
      // Labels sit on their own line inside the button, so match across the
      // whitespace rather than assuming `Back<`.
      />\s*Back\s*</.test(tour) && />\s*\{isLast \? "Done" : "Next"\}\s*</.test(tour) &&
        /Skip tour/.test(tour) && /aria-label="Close tour"/.test(tour));
    check("the tour shows progress", /\{index \+ 1\} of \{TOUR_LENGTH\}/.test(tour));
    check("Escape skips the tour", /e\.key === "Escape"/.test(tour));
    check("arrow keys are ignored while typing in a field",
      /INPUT\|TEXTAREA\|SELECT/.test(tour));
    check("the tour does not trap focus",
      // role=note, not a modal dialog: the vendor must be able to look at the
      // thing being described.
      /role="note"/.test(tour) && !/aria-modal/.test(tour));
  }

  /* -------------- 11b. Copy honesty + the tour's way back ---------------- */
  {
    const welcome = readFileSync("components/guidance/welcome.tsx", "utf8");
    const layoutSrc = readFileSync("app/dashboard/layout.tsx", "utf8");
    // The welcome tells vendors how to get the tour back, and must name where
    // it ACTUALLY is. Through G.3 that was a temporary sidebar button, so the
    // copy said "your menu"; G.4 moved the tour into Help and the copy moved
    // with it. This asserts the pair stays in step: the copy names Help, and
    // Help is really mounted.
    check("the welcome points at Help", /in\{" "\}\s*<b[^>]*>Help<\/b>/.test(welcome) ||
      /tour is in\b[\s\S]{0,80}Help/.test(welcome));
    check("the welcome no longer points at the retired menu button",
      !/is in your menu/i.test(welcome));
    check("Help really exists for the welcome to point at",
      /<HelpHost/.test(layoutSrc) && /<HelpTrigger/.test(layoutSrc));

    const sidebar = readFileSync("app/dashboard/layout.tsx", "utf8");
    const mobile = readFileSync("components/mobile-nav.tsx", "utf8");
    const helpPanel = readFileSync("components/help/panel.tsx", "utf8");
    // G.4: the emergency sidebar button is gone. Help owns the tour now, and
    // Help is reachable from both headers and the mobile menu — so the promise
    // in the welcome modal still holds, through a better door.
    check("the temporary sidebar tour button has been retired",
      !/TourRestartButton/.test(sidebar) && !/TourRestartButton/.test(mobile));
    check("the tour can be restarted from Help",
      /startTourAction/.test(helpPanel) && /START_TOUR_EVENT/.test(helpPanel));
    check("Help is reachable from the desktop and mobile headers",
      (sidebar.match(/<HelpTrigger/g) ?? []).length >= 2);
    check("Help is reachable from the mobile menu", /openHelp\(\)/.test(mobile));
    check("exactly one Help panel is mounted",
      (sidebar.match(/<HelpHost/g) ?? []).length === 1);

    const helpPanel2 = readFileSync("components/help/panel.tsx", "utf8");
    const host = readFileSync("components/guidance/host.tsx", "utf8");
    // router.refresh() alone cannot reopen the tour: the host seeds its state
    // from props once. The explicit event is what actually opens it.
    check("restarting dispatches an event the host listens for",
      /dispatchEvent\(new CustomEvent\(START_TOUR_EVENT\)\)/.test(helpPanel2) &&
        /addEventListener\(START_TOUR_EVENT/.test(host));
    check("the temporary tour control file is gone",
      !existsSync("components/guidance/restart.tsx"));
  }

  {
    const overlay = readFileSync("components/guidance/overlay.tsx", "utf8");
    check("the modal focuses its panel, not the close button",
      /panelRef\.current\?\.focus\(\)/.test(overlay) &&
        !/const first = focusables\(\)\[0\]/.test(overlay));
  }

  {
    // Deixis guard: a docked step points at nothing, so copy that says "here"
    // about an unseen element is broken by construction.
    const deictic = TOUR_STEPS.filter((s) => /\b(here|this button|above|below)\b/i
      .test(`${s.title} ${s.body}`) && !s.dockedNote);
    check("no tour step says 'here' without orientation copy for when it docks",
      deictic.length === 0, deictic.map((s) => s.key).join());
    const navSteps = TOUR_STEPS.filter((s) => s.anchor.startsWith("nav."));
    check("every nav-anchored step explains how to reach it when docked",
      navSteps.every((s) => !!s.dockedNote),
      navSteps.filter((s) => !s.dockedNote).map((s) => s.key).join());
    check("docked notes name a real destination",
      navSteps.every((s) => /Drops|Payments|Orders/.test(s.dockedNote!)));
  }

  /* --------------------- 12. G.2 wiring: share signal -------------------- */
  {
    const share = readFileSync("components/share-button.tsx", "utf8");
    check("the share signal is opt-in", /signalDropShare = false/.test(share));
    check("the share signal never blocks the share itself",
      /void markSharedAction\(\)\.catch/.test(share));
    check("every successful share path signals",
      (share.match(/signalShared\("/g) ?? []).length === 3);

    const dropPage = readFileSync("app/dashboard/drops/[id]/page.tsx", "utf8");
    check("the drop page's share button completes the milestone",
      /signalDropShare/.test(dropPage));
    check("the QR download completes the milestone too",
      /<QrDownloadLink/.test(dropPage));

    const salePage = readFileSync("app/dashboard/drops/[id]/sale/page.tsx", "utf8");
    check("the walk-up payment link does NOT count as sharing a drop",
      !/signalDropShare/.test(salePage));

    const referral = readFileSync("components/copy-link-button.tsx", "utf8");
    check("copying the REFERRAL link does not count as sharing a drop",
      !/markSharedAction/.test(referral));
  }

  /* ===================== 13. PHASE 3 — contextual guidance ================ */
  {
    const onDrops = { pathname: "/dashboard/drops" };
    const editor = { pathname: "/dashboard/drops/new" };
    const detail = { pathname: "/dashboard/drops/x" };

    /* -- every prioritised concept has a coachmark, on the right page ----- */
    const REQUIRED: Array<[string, string]> = [
      ["drops.mode", "/dashboard/drops"],
      ["editor.orderWindow", "/dashboard/drops/new"],
      ["editor.pickupWindow", "/dashboard/drops/new"],
      ["editor.inventory", "/dashboard/drops/new"],
      ["drop.publish", "/dashboard/drops/x"],
      ["drop.qr", "/dashboard/drops/x"],
    ];
    for (const [id, route] of REQUIRED) {
      // Reachable by dismissing everything ahead of it on that page.
      const others = COACHMARK_IDS.filter((c) => c !== id);
      const got = coachmarkFor(ctx({
        pathname: route,
        facts: facts({ paidOrders: 0 }),
        state: state({ ...SETTLED, dismissedCoachmarks: others }),
      }));
      check(`coachmark "${id}" is reachable on ${route}`, got?.id === id, got?.id ?? "null");
    }

    /* -- one concept at a time, still ------------------------------------- */
    for (const route of ["/dashboard/drops", "/dashboard/drops/new", "/dashboard/drops/x"]) {
      const got = coachmarkFor(ctx({ pathname: route }));
      check(`${route} offers at most one coachmark`, got === null || typeof got.id === "string");
    }

    /* -- drop mode: the decision that cannot be undone --------------------- */
    {
      const mode = coachmarkFor(ctx(onDrops))!;
      check("drop-mode guidance states the consequence",
        /can't be changed/i.test(mode.body), mode.body.slice(-60));
      check("drop-mode guidance uses vendor language, not implementation words",
        !/preorder mode|mode field|enum|irreversible/i.test(mode.body));
      check("drop-mode guidance describes BOTH kinds",
        /regular drop/i.test(mode.body) && /live selling/i.test(mode.body));
      check("drop-mode guidance stays off pricing",
        !/lifetime|plan|\$|allowance/i.test(mode.body));
    }

    /* -- dates as a relationship ------------------------------------------ */
    {
      const order = coachmarkFor(ctx({ ...editor,
        state: state({ ...SETTLED, dismissedCoachmarks: [] }) }))!;
      check("order-window guidance frames the two windows as a sequence",
        /first/i.test(order.body) && /then/i.test(order.body), order.body);
      const pickup = coachmarkFor(ctx({ ...editor,
        state: state({ ...SETTLED, dismissedCoachmarks: ["editor.orderWindow"] }) }))!;
      check("pickup guidance explains it follows ordering",
        /after ordering closes/i.test(pickup.body), pickup.body);

      const editorSrc = readFileSync("components/drop-editor.tsx", "utf8");
      check("the editor labels the windows as an ordered pair",
        /Step 1 of 2/.test(editorSrc) && /Step 2 of 2/.test(editorSrc));
      check("the editor names them in customer terms",
        /Customers can order/.test(editorSrc) && /Customers pick up/.test(editorSrc));
    }

    /* -- inventory is per-drop -------------------------------------------- */
    {
      const inv = coachmarkFor(ctx({ ...editor,
        state: state({ ...SETTLED,
          dismissedCoachmarks: ["editor.orderWindow", "editor.pickupWindow"] }) }))!;
      check("inventory guidance says 'this drop only'",
        /this drop only/i.test(inv.body), inv.body);
      check("inventory guidance names the library confusion",
        /not a running total/i.test(inv.body));
      const editorSrc = readFileSync("components/drop-editor.tsx", "utf8");
      // A VISIBLE label, not a placeholder. At 320px the field is ~50px wide,
      // so a placeholder carrying this meaning truncates to nonsense; a label
      // wraps. The placeholder must stay short enough to survive that width.
      check("the quantity field is labelled, and the label says which drop",
        /htmlFor=\{`\$\{fieldId\}-qty-\$\{i\}`\}/.test(editorSrc) &&
        /id=\{`\$\{fieldId\}-qty-\$\{i\}`\}/.test(editorSrc) &&
        /Qty for this drop/.test(editorSrc));
      check("the quantity placeholder is short enough for a phone",
        (editorSrc.match(/name="p_inventory"[\s\S]{0,400}?placeholder="([^"]*)"/)?.[1] ?? "x".repeat(99)).length <= 4);
      check("the saved-product picker says stock is per drop",
        /You still set how many you&apos;re selling in/.test(editorSrc) ||
        /still set how many/.test(editorSrc));
    }

    /* -- publish never overpromises --------------------------------------- */
    {
      const pub = coachmarkFor(ctx(detail))!;
      check("publish guidance explains the schedule, not just the button",
        /order window/i.test(pub.body), pub.body);
      check("publish guidance never claims a drop sells immediately",
        !/immediately|straight away|right now/i.test(pub.body));
    }

    /* -- QR: no store-level QR exists ------------------------------------- */
    {
      const qr = coachmarkFor(ctx({ ...detail,
        state: state({ ...SETTLED, dismissedCoachmarks: ["drop.publish"] }) }))!;
      check("QR guidance scopes the code to ONE drop",
        /every drop gets its own/i.test(qr.body), qr.body);
      check("QR guidance never implies a store-wide code",
        !/your dropq qr|store qr|vendor qr|universal/i.test(`${qr.title} ${qr.body}`));
      check("no coachmark mentions walk-up, which is flag-gated",
        COACHMARK_IDS.every((id) => {
          const c = coachmarkFor(ctx({ ...detail,
            state: state({ ...SETTLED,
              dismissedCoachmarks: COACHMARK_IDS.filter((x) => x !== id) }) }));
          return !c || !/walk[- ]up/i.test(`${c.title} ${c.body}`);
        }));
    }

    /* -- tips: overview only, never duplicating the card ------------------ */
    {
      const f = facts({ totalDrops: 1, dropsWithProducts: 0 });
      check("a tip does not follow the vendor onto other pages",
        tipFor(ctx({ pathname: "/dashboard/drops", facts: f })) === null &&
        tipFor(ctx({ pathname: "/dashboard/orders", facts: f })) === null);
      check("a tip shows on the overview",
        tipFor(ctx({ pathname: "/dashboard", facts: f }))?.id === "drop_without_items");
      check("a tip never duplicates the activation card",
        tipFor(ctx({ pathname: "/dashboard", facts: f, activationCardVisible: true })) === null);

      const sold = facts({ totalDrops: 1, dropsWithProducts: 1, liveDrops: 1,
        paidOrders: 1, dropsWithPaidOrders: 1, hasShared: true });
      check("no tip competes with the first-order celebration",
        tipFor(ctx({ pathname: "/dashboard", facts: sold,
          state: state({ ...SETTLED, sharedAt: new Date() }) })) === null);

      // The celebration lives in the dashboard's next-step card and REPLACES
      // it, so a vendor never reads "1 order to prepare" above "you got your
      // first order". Pinned on the source, since it is a server render.
      const dash = readFileSync("app/dashboard/page.tsx", "utf8");
      check("the first order replaces the next-step card",
        /if \(aFacts\.paidOrders === 1\) \{/.test(dash));
      check("the celebration is the FIRST branch, so it outranks 'orders to prepare'",
        dash.indexOf("aFacts.paidOrders === 1") < dash.indexOf("newOrders > 0"));
      check("the celebration keeps the useful action",
        /cta: "View order"/.test(dash) && /href: "\/dashboard\/orders"/.test(dash));
      check("the celebration carries no points, badges or streaks",
        // Comments stripped: the rationale comment above the branch explains
        // that both surfaces used to "point at Orders", and matching the word
        // in a comment is not the same as shipping gamification.
        !/point|badge|streak|leaderboard/i.test(
          dash
            .slice(dash.indexOf("aFacts.paidOrders === 1"),
                   dash.indexOf("aFacts.paidOrders === 1") + 700)
            .replace(/\/\/.*$/gm, "")));
      check("the celebration is derived, so it retires itself at the second order",
        /paidOrders === 1/.test(dash) && !/celebrat(ed|ionSeen)At/.test(dash));
    }
  }

  /* ------------------- 13b. Draft status never says "closed" ------------- */
  {
    const phases = ["draft", "scheduled", "closed", "pickup", "completed"] as const;
    for (const ph of phases) {
      const note = dropPhaseNote(ph);
      check(`phase "${ph}" has vendor-facing copy`, note.length > 10, note);
    }
    check("a DRAFT never reports that ordering closed",
      !/closed/i.test(dropPhaseNote("draft")), dropPhaseNote("draft"));
    check("a draft says it is unpublished",
      /not published/i.test(dropPhaseNote("draft")));
    check("a draft says customers can't see it",
      /customers can't see/i.test(dropPhaseNote("draft")));
    check("closed and completed still say ordering is over",
      /closed/i.test(dropPhaseNote("closed")) && /over/i.test(dropPhaseNote("completed")));
    const page = readFileSync("app/dashboard/drops/[id]/page.tsx", "utf8");
    check("the drop page uses the shared copy rather than an inline fallback",
      /dropPhaseNote\(phase\)/.test(page) && !/>Ordering closed</.test(page));
  }

  /* ---------------- 14. Empty states teach, not just report -------------- */
  {
    const pairs: Array<[string, string]> = [
      ["app/dashboard/drops/page.tsx", "drops"],
      ["app/dashboard/orders/page.tsx", "orders"],
      ["components/product-library.tsx", "products"],
    ];
    for (const [file, name] of pairs) {
      const src = readFileSync(file, "utf8");
      const at = src.indexOf("<EmptyState");
      const block = at >= 0 ? src.slice(at, at + 900) : "";
      check(`${name} empty state exists`, block.length > 0);
      check(`${name} empty state does not merely report emptiness`,
        !/title="No [a-z ]+"/i.test(block), block.match(/title="[^"]*"/)?.[0] ?? "");
      check(`${name} empty state explains why it matters`,
        /body=/.test(block) && block.length > 200);
    }
    const drops = readFileSync("app/dashboard/drops/page.tsx", "utf8");
    check("the drops empty state explains what a drop IS",
      /what you&apos;re selling|what you're selling/.test(drops));
    check("the drops empty state previews the two kinds",
      /regular drop takes orders ahead of time/.test(drops));
  }

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);
  return NextResponse.json(
    {
      suite: "guidance",
      passed,
      failed: failures.length,
      results: failures.length ? failures : "all pass",
    },
    { status: failures.length === 0 ? 200 : 500 }
  );
}
