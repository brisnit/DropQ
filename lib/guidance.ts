/**
 * Vendor guidance — the single derivation of "what, if anything, should we be
 * teaching this vendor right now?"
 *
 * This module is the guidance counterpart to lib/activation.ts, and it follows
 * the same discipline for the same reasons:
 *
 *   ACTIVATION answers "what has this vendor done and can they sell?"
 *   GUIDANCE   answers "what should we explain, and have we already?"
 *
 * Everything about *progress* is derived from authoritative state and is never
 * stored. The only stored facts are UI acknowledgements — the tour position and
 * which coachmarks a vendor closed — and those live in `VendorGuidance` because
 * they have no upstream source of truth to drift from.
 *
 * ⚠️ NOT "server-only". This module is imported by client components (the tour
 * driver, coachmark bubbles), so it must stay free of Prisma, `server-only`,
 * environment reads and anything else that can't cross the boundary. Loading
 * the state is lib/guidance-state.ts's job; deciding what to do with it is
 * this file's.
 *
 * THE RULE THIS FILE ENFORCES STRUCTURALLY:
 *
 *     At most one coachmark and at most one tip, ever, per render.
 *
 * `coachmarkFor()` and `tipFor()` return a single value or null — there is no
 * `coachmarksFor()` returning an array, deliberately. "One concept at a time"
 * is a signature, not a convention someone has to remember.
 */

import type { ActivationFacts, ActivationState } from "@/lib/activation";

/**
 * The activation shape as it crosses to the client.
 *
 * Structurally `ActivationState`; aliased so client modules can name it
 * without reading as though they import a `server-only` module. Type-only, so
 * nothing is emitted either way.
 */
export type ActivationStateLike = ActivationState;

/* ------------------------------- Applicability --------------------------- */

/**
 * The seller fields guidance needs to decide whether it applies at all.
 * Structurally identical to what `isDemoStore` wants, plus `internalKind`.
 */
export type GuidanceSeller = {
  email: string;
  slug: string;
  /** DropQ-controlled account: founder, canary, staff, demo store. */
  internalKind: string | null;
};

const DEMO_SELLER_EMAIL = "showcase@dropq.example";
const DEMO_SELLER_SLUG = "marble-crumb";

/**
 * Should this vendor ever see guidance UI?
 *
 * No for the marketing showcase store (it is a storefront prop, not a vendor)
 * and no for internal accounts — founder, staff, smoke-test and canary
 * accounts are not learning the product, and a welcome modal in a screenshot
 * or a smoke test is noise.
 *
 * Mirrors `isDemoStore()` from lib/demo.ts rather than importing it: that
 * module is fine to import here today, but guidance runs on the client and
 * this keeps the client boundary free of a server-side import chain. The
 * constants are pinned by the self-test so the two can't silently diverge.
 *
 * ⚠️ The documentation vendor (Phase 5) sets `internalKind: "docs"` and is
 * therefore excluded here — which is wrong for screenshots, since we need to
 * photograph the guidance UI. Phase 5 opts it back in explicitly; see
 * `guidanceApplicable`'s `force` argument.
 */
export function guidanceApplicable(
  seller: GuidanceSeller,
  /** Phase 5 screenshot fixture only. Never set this from vendor UI. */
  force = false
): boolean {
  if (force) return true;
  if (seller.email === DEMO_SELLER_EMAIL || seller.slug === DEMO_SELLER_SLUG) return false;
  if (seller.internalKind) return false;
  return true;
}

/* ---------------------------------- Tiers -------------------------------- */

/**
 * How much explaining this vendor still needs.
 *
 * Three tiers, not four. The audit proposed an "advanced" tier for walk-up and
 * DropMeet, but those are FEATURE AVAILABILITY, not vendor progress: a brand
 * new vendor in the walk-up pilot has access on day one, and an experienced
 * vendor outside it never will. Folding an env flag into a progress tier would
 * make the tier untestable (it would change with `WALKUP_ENABLED`) and would
 * mean a pilot vendor "graduated" without doing anything. Availability travels
 * separately in `GuidanceCapabilities`.
 */
export type GuidanceTier = "beginner" | "selling" | "established";

/**
 * The facts tiering needs. A superset of `ActivationFacts` so a caller that
 * already loaded activation only needs two more counts.
 */
export type GuidanceFacts = ActivationFacts & {
  /** Every drop this vendor owns, in any status. */
  totalDrops: number;
  /** Distinct drops that have at least one paid order. */
  dropsWithPaidOrders: number;
  /** Buyers who have ordered from this vendor more than once. */
  repeatCustomers: number;
  /**
   * Published preorder drops whose order window opens within the next 24h.
   * Computed against the loader's clock, never re-derived here — this module
   * must not read `Date.now()`, or the same inputs would stop producing the
   * same output and the whole thing becomes untestable.
   */
  dropsOpeningTomorrow: number;
};

/**
 * Beginner    → has never taken money. Everything still needs explaining.
 * Selling     → has taken money. Stop explaining the basics; start on the
 *               things that only matter once orders exist.
 * Established → has repeat business or a second successful drop. Promote the
 *               growth surfaces (analytics, discovery) that would have been
 *               noise on day one.
 *
 * Note it is one-way in practice but not latched: a vendor whose only paid
 * order is refunded away would fall back a tier. That is acceptable — the
 * tier only changes how loudly DropQ explains things, never what a vendor can
 * do, so a wrong answer costs a slightly wordy dashboard and nothing else.
 */
export function guidanceTier(facts: GuidanceFacts): GuidanceTier {
  if (facts.paidOrders === 0) return "beginner";
  if (facts.repeatCustomers > 0 || facts.dropsWithPaidOrders > 1) return "established";
  return "selling";
}

const TIER_RANK: Record<GuidanceTier, number> = {
  beginner: 0,
  selling: 1,
  established: 2,
};

/** Is `tier` at or past `min`? */
export function tierAtLeast(tier: GuidanceTier, min: GuidanceTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}

/**
 * Feature availability, resolved by the caller from the same server-side gates
 * the features themselves use — `isWalkUpEnabled(seller)`, a live DropMeet
 * region, `hasGrowthFeatures(seller)`.
 *
 * Guidance NEVER computes these itself. If it did, it would be a second
 * implementation of a gate, and the failure mode is teaching a vendor about a
 * button they do not have.
 */
export type GuidanceCapabilities = {
  walkUp: boolean;
  dropMeet: boolean;
  growthFeatures: boolean;
};

export const NO_CAPABILITIES: GuidanceCapabilities = {
  walkUp: false,
  dropMeet: false,
  growthFeatures: false,
};

/* --------------------------------- Anchors ------------------------------- */

/**
 * Every element in the dashboard that guidance can point at.
 *
 * This registry is the contract between three consumers that must never drift:
 *
 *   1. the tour        — positions each step against an anchor
 *   2. coachmarks      — point at the feature they describe
 *   3. screenshots     — draw highlight overlays on the same elements (Phase 5)
 *
 * Because it is a typed const, a coachmark that names a nonexistent anchor is
 * a compile error rather than a bubble that renders in the top-left corner. The
 * value is the route the anchor lives on, which is what lets `coachmarkFor()`
 * refuse to offer a coachmark for an element that isn't on screen.
 *
 * Adding an anchor here does nothing on its own — Phase 2 adds the matching
 * `<GuidanceAnchor>` wrappers at the call sites.
 */
export const ANCHORS = {
  "nav.drops": "/dashboard",
  "nav.payments": "/dashboard",
  "nav.orders": "/dashboard",
  "dash.checklist": "/dashboard",
  "dash.newDrop": "/dashboard",
  "drops.modePick": "/dashboard/drops",
  "editor.orderWindow": "/dashboard/drops/new",
  "editor.pickupWindow": "/dashboard/drops/new",
  "editor.inventory": "/dashboard/drops/new",
  "editor.saveBar": "/dashboard/drops/new",
  "drop.publish": "/dashboard/drops/[id]",
  "drop.qr": "/dashboard/drops/[id]",
  "drop.close": "/dashboard/drops/[id]",
} as const;

export type AnchorId = keyof typeof ANCHORS;

/** The DOM selector for an anchor. The one place this string is built. */
export function anchorSelector(id: AnchorId): string {
  return `[data-guidance-anchor="${id}"]`;
}

/**
 * Does an anchor live on the page currently being rendered?
 *
 * Routes are compared with Next's `[param]` segments treated as wildcards, so
 * "/dashboard/drops/[id]" matches "/dashboard/drops/clx123" but not
 * "/dashboard/drops/clx123/edit" or "/dashboard/drops/new".
 */
export function anchorOnRoute(id: AnchorId, pathname: string): boolean {
  return routeMatches(ANCHORS[id], pathname);
}

/**
 * Literal segments that sit beside a dynamic one and must never be captured by
 * it. `/dashboard/drops/new` is a real page, and "new" is a legal id shape — so
 * without this, every `/dashboard/drops/[id]` anchor "matches" the editor.
 *
 * That is not cosmetic. `coachmarkFor` picks the first coachmark whose anchor
 * is on-route; a drop-detail coachmark selected on the editor page renders
 * nothing (its element isn't there) and silently starves the editor coachmark
 * that should have shown.
 */
const RESERVED_SEGMENTS = new Set(["new", "edit", "sale"]);

export function routeMatches(pattern: string, pathname: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const a = pathname.split("/").filter(Boolean);
  if (p.length !== a.length) return false;
  return p.every((seg, i) =>
    seg.startsWith("[") && seg.endsWith("]")
      ? !RESERVED_SEGMENTS.has(a[i])
      : seg === a[i]
  );
}

/* ---------------------------------- Tour --------------------------------- */

export type TourStatus = "not_started" | "in_progress" | "completed" | "skipped";

/**
 * Asks the mounted guidance host to open the tour.
 *
 * A DOM event because the trigger (inside the Help panel) and the host (in the
 * dashboard layout) are different React trees. `router.refresh()` cannot do the
 * job: the host seeds its state from props once, so a refresh updates the prop
 * and never the state.
 */
export const START_TOUR_EVENT = "dropq:guidance-start-tour";

export type TourStep = {
  key: string;
  anchor: AnchorId;
  title: string;
  body: string;
  /**
   * Shown ONLY when the step is docked — i.e. its anchor isn't on screen,
   * which in practice means the sidebar nav on a phone.
   *
   * Without this, a docked step points at nothing while its copy implies a
   * location. Copy must never say "here" about an element the vendor cannot
   * see; where a step is about a nav destination, this says how to reach it.
   */
  dockedNote?: string;
};

/**
 * Six steps, not seven.
 *
 * The brief proposed a "Products" step, but there is no dashboard element to
 * anchor it to — adding products happens inside the drop editor, which is a
 * different page reached by an action the tour is not allowed to take on the
 * vendor's behalf. Teaching it as a floating card would break the rule that
 * the tour highlights the real interface. It is taught in place instead, by
 * the `editor.*` coachmarks, at the moment it actually happens.
 *
 * Copy rule: say what the thing is FOR, in words a vendor would use. Never
 * "configure", "manage" or "parameters".
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    key: "home",
    anchor: "dash.checklist",
    title: "This is home base",
    body: "Your drops, your orders, and whatever needs doing next. This checklist tracks itself — you never tick anything off by hand.",
  },
  {
    key: "create",
    anchor: "dash.newDrop",
    title: "Start with a drop",
    body: "A drop is what you're selling, where people get it, and when they can order. It's the thing you share.",
  },
  {
    key: "drops",
    anchor: "nav.drops",
    title: "Two kinds of drop",
    body: "A regular drop takes preorders in a window you set. A live selling drop opens straight away for people standing in front of you. You choose once, when you create it.",
    dockedNote: "Your drops live under Drops. Tap \u2630 at the top right to open your menu.",
  },
  {
    key: "payments",
    anchor: "nav.payments",
    title: "Connect Stripe to get paid",
    body: "Card payments go to your own Stripe account. You'll need this connected before a drop can go live.",
    dockedNote: "Stripe setup lives under Payments. Tap \u2630 at the top right to open your menu.",
  },
  {
    key: "orders",
    anchor: "nav.orders",
    title: "Every order in one place",
    body: "Orders from all your drops, newest first. Mark them off as you prepare them and hand them over.",
    dockedNote: "You'll find them under Orders. Tap \u2630 at the top right to open your menu.",
  },
  {
    key: "share",
    anchor: "dash.newDrop",
    title: "Then share it",
    body: "Every drop gets a link and a QR code. Post the link, print the QR — that's how customers order.",
  },
] as const;

export const TOUR_LENGTH = TOUR_STEPS.length;

/** Clamp a stored step index to something renderable. */
export function safeTourStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.min(Math.max(Math.trunc(step), 0), TOUR_LENGTH - 1);
}

/* --------------------------------- State --------------------------------- */

/**
 * The stored half of guidance. Mirrors `VendorGuidance` but is a plain type so
 * client components can hold it without importing Prisma's generated types.
 */
export type GuidanceState = {
  welcomeSeenAt: Date | null;
  tourStatus: TourStatus;
  tourStep: number;
  dismissedCoachmarks: string[];
  dismissedTips: string[];
  sharedAt: Date | null;
  helpOpenedAt: Date | null;
};

/** What a seller with no row reads as. Never persisted; just the zero value. */
export const DEFAULT_GUIDANCE_STATE: GuidanceState = {
  welcomeSeenAt: null,
  tourStatus: "not_started",
  tourStep: 0,
  dismissedCoachmarks: [],
  dismissedTips: [],
  sharedAt: null,
  helpOpenedAt: null,
};

/**
 * Show the welcome modal?
 *
 * Exactly once, ever. `welcomeSeenAt` is stamped when it is DISPLAYED, not
 * when it is dismissed, so closing the tab or a mid-render navigation cannot
 * produce a second showing.
 *
 * Vendors who predate this feature were stamped by the migration's backfill,
 * so they never see it unprompted — they opt into the tour from Help instead.
 */
export function shouldShowWelcome(state: GuidanceState): boolean {
  return state.welcomeSeenAt === null;
}

/** Is the tour something this vendor can be resumed into automatically? */
export function shouldResumeTour(state: GuidanceState): boolean {
  return state.tourStatus === "in_progress";
}

/**
 * "Take the DropQ tour" vs "Restart the tour" — the Help panel's label.
 * A vendor who has never started it is being offered something new; a vendor
 * who finished or skipped it is being offered a repeat.
 */
export function tourInviteLabel(state: GuidanceState): string {
  return state.tourStatus === "not_started" || state.tourStatus === "in_progress"
    ? "Take the DropQ tour"
    : "Restart the DropQ tour";
}

/* ------------------------------- Coachmarks ------------------------------ */

export type CoachmarkId =
  | "drops.mode"
  | "editor.orderWindow"
  | "editor.pickupWindow"
  | "editor.inventory"
  | "drop.publish"
  | "drop.qr"
  | "drop.close";

export type Coachmark = {
  id: CoachmarkId;
  anchor: AnchorId;
  title: string;
  body: string;
};

/**
 * Definition order IS priority order: the first one whose conditions hold wins,
 * exactly like `nextAction()` in lib/activation.ts. Earlier entries are the
 * ones a vendor meets earlier in the journey, so a vendor on a page with two
 * eligible coachmarks always gets the more foundational one first, and the
 * other one on their next visit.
 */
type CoachmarkDef = Coachmark & {
  /** Highest tier that still needs this explained. */
  maxTier: GuidanceTier;
  /** Extra condition beyond route + tier + not-yet-dismissed. */
  when?: (ctx: GuidanceContext) => boolean;
};

const COACHMARKS: readonly CoachmarkDef[] = [
  {
    id: "drops.mode",
    anchor: "drops.modePick",
    title: "Which kind of drop?",
    // The consequence is stated last and plainly. Not "irreversible", not a
    // warning triangle — just the fact, after the vendor knows enough to act
    // on it. Pricing deliberately isn't mentioned: the lifetime allowance is
    // explained where the counter lives, not stapled to every decision.
    body: "A regular drop takes orders ahead of time, and customers collect during a window you set. A live selling drop is for selling in person right now — people scan your QR and order while they're standing with you. You choose this once; it can't be changed after the drop is created.",
    maxTier: "selling",
  },
  {
    id: "editor.orderWindow",
    anchor: "editor.orderWindow",
    title: "Two windows, in order",
    body: "First, when customers can order. Then, separately, when they collect. Ordering locks itself at the close time — you don't have to be there for it.",
    maxTier: "beginner",
  },
  {
    id: "editor.pickupWindow",
    anchor: "editor.pickupWindow",
    title: "When do they collect?",
    body: "Pickup starts at or after ordering closes, so you have time to make everything. Customers see this window on their order.",
    maxTier: "beginner",
  },
  {
    id: "editor.inventory",
    anchor: "editor.inventory",
    title: "How many for this drop?",
    // Names the confusion directly: a saved product looks global, so vendors
    // reasonably assume the number is too.
    body: "This is the quantity available in this drop only — not a running total for the product. DropQ stops taking orders when it's reached, so you can't be oversold.",
    maxTier: "beginner",
  },
  {
    id: "drop.publish",
    anchor: "drop.publish",
    title: "What publishing does",
    body: "Publishing puts this drop on your storefront. Customers can order it during the order window you set — not before, and not after it closes.",
    maxTier: "selling",
    // Only where publishing is genuinely available. A vendor who isn't
    // charge-ready sees the Stripe gate in place of the button, and telling
    // them what publishing does would imply they can do it.
    when: (ctx) => ctx.activation.readyToSell,
  },
  {
    id: "drop.qr",
    anchor: "drop.qr",
    title: "This drop's QR code",
    // "This drop's", never "your QR code": there is no store-level or vendor
    // QR in DropQ. Every QR belongs to one drop.
    body: "Every drop gets its own link and its own QR. Anyone who scans this one lands on this drop and can order. Download it, print it, put it on your table.",
    maxTier: "selling",
  },
  {
    id: "drop.close",
    anchor: "drop.close",
    title: "Closing vs deleting",
    body: "Closing stops new orders and keeps everything — your orders, your items, your customers. You can reopen it later. Deleting removes the drop and its orders for good.",
    maxTier: "selling",
    // Only worth saying once there is something to lose.
    when: (ctx) => ctx.facts.paidOrders > 0,
  },
] as const;

/** Everything `coachmarkFor` / `tipFor` need. Assembled once by the caller. */
export type GuidanceContext = {
  pathname: string;
  tier: GuidanceTier;
  state: GuidanceState;
  facts: GuidanceFacts;
  activation: ActivationState;
  capabilities: GuidanceCapabilities;
  /**
   * Is the "Get ready to sell" card on screen right now?
   *
   * Computed server-side by the caller from `activationCardMode()`. It cannot
   * be derived here: that function lives in a `server-only` module, and this
   * one is imported by client components.
   *
   * It exists because the card already IS the next-action surface during
   * activation. A tip repeating "Connect Stripe" underneath a card that says
   * "Connect Stripe" is the exact duplication Phase V removed.
   */
  activationCardVisible: boolean;
};

/**
 * The one coachmark to show right now, or null.
 *
 * Suppressed entirely while the tour is running: a tour step and a coachmark
 * are the same visual object, and two of them on screen at once is the
 * "Christmas tree" failure the brief explicitly rules out.
 */
export function coachmarkFor(ctx: GuidanceContext): Coachmark | null {
  if (ctx.state.tourStatus === "in_progress") return null;

  for (const c of COACHMARKS) {
    if (ctx.state.dismissedCoachmarks.includes(c.id)) continue;
    if (!anchorOnRoute(c.anchor, ctx.pathname)) continue;
    if (!tierAtMost(ctx.tier, c.maxTier)) continue;
    if (c.when && !c.when(ctx)) continue;
    const { maxTier: _maxTier, when: _when, ...coachmark } = c;
    return coachmark;
  }
  return null;
}

function tierAtMost(tier: GuidanceTier, max: GuidanceTier): boolean {
  return TIER_RANK[tier] <= TIER_RANK[max];
}

/** Every coachmark id, for the self-test and for a "reset guidance" action. */
export const COACHMARK_IDS: readonly CoachmarkId[] = COACHMARKS.map((c) => c.id);

/* -------------------------------- Smart tips ----------------------------- */

export type TipId =
  | "drop_without_items"
  | "items_without_stripe"
  | "published_not_shared"
  | "opens_tomorrow"
  | "repeat_customers";

export type Tip = {
  id: TipId;
  /** One sentence. States the situation, not the instruction. */
  body: string;
  cta: string;
  href: string;
  /** Celebrations render differently from nudges. */
  tone: "nudge" | "win";
};

/**
 * Contextual nudges, derived entirely from state — nothing here is stored
 * except the vendor's dismissal.
 *
 * Order is priority: the first match wins, and a vendor sees at most one. The
 * ordering deliberately puts "you are blocked" above "you could do more", the
 * same way `nextAction()` does, so a vendor is never nudged toward polish
 * while something is actually broken.
 *
 * ⚠️ Copy note: none of these mention followers. Following is real in the
 * schema but there is no vendor-facing follower list, count or audience, and
 * broadcasts resolve from ORDERS. Saying "remind your followers" would promise
 * a capability that does not exist. See docs/VENDOR-GUIDANCE.md §Q2.
 */
type TipDef = Tip & { when: (ctx: GuidanceContext) => boolean };

const TIPS: readonly TipDef[] = [
  {
    id: "drop_without_items",
    body: "Your drop doesn't have anything to sell yet.",
    cta: "Add your first item",
    href: "/dashboard/drops",
    tone: "nudge",
    when: (ctx) => ctx.facts.dropsWithProducts === 0 && ctx.facts.totalDrops > 0,
  },
  {
    id: "items_without_stripe",
    body: "Your drop is ready. Connecting Stripe is the last thing between you and taking orders.",
    cta: "Connect Stripe",
    href: "/dashboard/payments",
    tone: "nudge",
    when: (ctx) => ctx.facts.dropsWithProducts > 0 && !ctx.activation.readyToSell,
  },
  {
    id: "published_not_shared",
    body: "Your drop is live. Nobody can order until they have the link.",
    cta: "Share your drop",
    href: "/dashboard/drops",
    tone: "nudge",
    when: (ctx) =>
      ctx.facts.liveDrops > 0 && ctx.state.sharedAt === null && ctx.facts.paidOrders === 0,
  },
  {
    id: "opens_tomorrow",
    body: "Your order window opens tomorrow.",
    cta: "Share your link now",
    href: "/dashboard/drops",
    tone: "nudge",
    when: (ctx) => ctx.facts.dropsOpeningTomorrow > 0,
  },
  // NOTE: the first paid order is deliberately NOT a tip. It owns the
  // dashboard's next-step card for that one state (app/dashboard/page.tsx), so
  // the moment and the instruction are one surface instead of two saying the
  // same thing. See docs/VENDOR-GUIDANCE.md.
  {
    id: "repeat_customers",
    body: "People are coming back — you have customers who've ordered more than once.",
    cta: "Message your customers",
    href: "/dashboard/customers",
    tone: "win",
    when: (ctx) => ctx.facts.repeatCustomers > 0,
  },
] as const;

/** Tips live on the overview only. See `tipFor`. */
export const TIP_ROUTE = "/dashboard";

/**
 * The one tip to show right now, or null.
 *
 * Two suppressions beyond dismissal, both about not saying the same thing
 * twice:
 *
 *  1. **Only on the overview.** These are "what should I do next" nudges, and
 *     following a vendor onto every dashboard screen with one is nagging.
 *  2. **Never while the activation card is visible.** The card is the
 *     next-action surface for a vendor who is still activating, and it already
 *     covers items/Stripe/publish/share. Once it hides — the vendor can sell
 *     and has sold — tips take over for the ongoing lifecycle, which is where
 *     "this new drop has no items yet" and "you got your first order" belong.
 */
export function tipFor(ctx: GuidanceContext): Tip | null {
  if (ctx.state.tourStatus === "in_progress") return null;
  if (ctx.pathname !== TIP_ROUTE) return null;
  if (ctx.activationCardVisible) return null;
  for (const t of TIPS) {
    if (ctx.state.dismissedTips.includes(t.id)) continue;
    if (!t.when(ctx)) continue;
    const { when: _when, ...tip } = t;
    return tip;
  }
  return null;
}

export const TIP_IDS: readonly TipId[] = TIPS.map((t) => t.id);

/* ------------------------------- Entry point ----------------------------- */

export type GuidanceDecision = {
  applicable: boolean;
  tier: GuidanceTier;
  showWelcome: boolean;
  resumeTour: boolean;
  coachmark: Coachmark | null;
  tip: Tip | null;
};

/**
 * THE entry point. One call, one answer, and the answer can only ever contain
 * one interruption.
 *
 * The precedence is welcome > tour > coachmark > tip, and it is enforced here
 * rather than left to the components, because "don't cover the screen in five
 * things" is a product rule and product rules belong somewhere testable.
 */
export function guidanceFor(
  seller: GuidanceSeller,
  ctx: GuidanceContext,
  force = false
): GuidanceDecision {
  const applicable = guidanceApplicable(seller, force);
  if (!applicable) {
    return {
      applicable: false,
      tier: ctx.tier,
      showWelcome: false,
      resumeTour: false,
      coachmark: null,
      tip: null,
    };
  }

  const showWelcome = shouldShowWelcome(ctx.state);
  const resumeTour = !showWelcome && shouldResumeTour(ctx.state);
  const busy = showWelcome || resumeTour;

  const coachmark = busy ? null : coachmarkFor(ctx);
  const tip = busy || coachmark ? null : tipFor(ctx);

  return { applicable: true, tier: ctx.tier, showWelcome, resumeTour, coachmark, tip };
}
