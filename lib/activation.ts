import "server-only";
import { prisma } from "@/lib/db";
import { isVendorSellable } from "@/lib/payments";
import { isDemoStore } from "@/lib/demo";

/**
 * Vendor activation — the single derivation of "what has this vendor done, what
 * should they do next, and can they sell yet?"
 *
 * Everything here is DERIVED from authoritative state. There is deliberately no
 * `readyToSell` column and no onboarding table: a cached flag would go stale the
 * moment Stripe revokes charges, which is exactly the failure the Phase A.1
 * alert exists to catch. Nothing in this module is stored, so nothing can drift
 * and there is no onboarding state to reset or backfill.
 *
 * THE PRODUCT RULE, and the only hard requirement in the codebase:
 *
 *     Ready to Sell === the vendor's Stripe account is currently charge-ready.
 *
 * Products, drops and a filled-in profile are progress milestones, not
 * requirements. `updateStoreAction` makes every profile field nullable, so
 * "incomplete profile" is not a thing that exists — inventing one would pad a
 * progress bar with a requirement the platform does not actually have.
 *
 * This module DERIVES; it never enforces. The authoritative server-side gate
 * stays `isVendorSellable()` in lib/payments.ts, applied by placeOrderAction and
 * resolveDropStatus. Hiding or showing UI here changes nothing about that.
 */

/* ------------------------------- Stripe state ---------------------------- */

/**
 * `stripeChargesEnabled` is authoritative for CURRENT state.
 * `stripeChargesEnabledAt` records the FIRST time it became true and is never
 * cleared, which is the only way to tell "was selling, now restricted" from
 * "never finished onboarding" — two situations that need very different words.
 *
 * `unknown` exists because of vendors who were already charge-ready before we
 * started recording the timestamp (see docs/VENDOR-ACTIVATION.md §4.1). They are
 * NOT misclassified as never-started: `stripeAccountId` rules that out. It
 * degrades to the same copy the payments page already shows.
 */
export type StripeActivationState =
  | "suspended" // admin-disabled vendor; nothing else matters
  | "not_started" // never created a Stripe account
  | "incomplete" // account exists, not charge-ready, never known to have been
  | "restricted" // was charge-ready, Stripe has since turned charges off
  | "unknown" // account exists, not charge-ready, activated before we tracked it
  | "charge_ready";

export type SellerActivationFields = {
  disabledAt: Date | null;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  /**
   * First time charges were observed enabled; never cleared. Optional because
   * the column lands in V.1 — until then every vendor reads as undefined, which
   * falls through to the same `unknown`/paid-order handling as a pre-tracking
   * vendor. That keeps V.0 usable today and makes V.1 purely additive.
   */
  stripeChargesEnabledAt?: Date | null;
};

export function stripeActivationState(
  seller: SellerActivationFields,
  /** Pass true only when we know this vendor has taken a real Stripe payment. */
  hasEverSold = false
): StripeActivationState {
  if (seller.disabledAt) return "suspended";
  if (isVendorSellable(seller)) return "charge_ready";
  if (!seller.stripeAccountId) return "not_started";
  // Not charge-ready, but an account exists. Was it ever live?
  if (seller.stripeChargesEnabledAt) return "restricted";
  // A completed Stripe payment is proof they were charge-ready at the time,
  // even if it predates the timestamp column.
  if (hasEverSold) return "restricted";
  return "unknown";
}

/** Does this state mean "you cannot sell"? Every state except charge_ready. */
export function stripeBlocksSelling(s: StripeActivationState): boolean {
  return s !== "charge_ready";
}

/* -------------------------------- Milestones ----------------------------- */

export type MilestoneKey = "account" | "email" | "stripe" | "drop" | "publish";

export type Milestone = {
  key: MilestoneKey;
  label: string;
  done: boolean;
  /** Only Stripe is an actual requirement for selling. */
  requiredToSell: boolean;
};

/**
 * The facts the milestones are derived from. Passed in rather than queried so
 * the derivation stays pure and testable, and so a caller that already has the
 * counts doesn't re-query.
 */
export type ActivationFacts = {
  /** Drops owned by this seller that have at least one product. */
  dropsWithProducts: number;
  /** Drops currently `status: "live"`. */
  liveDrops: number;
  /** Orders with paymentStatus "paid". */
  paidOrders: number;
};

/**
 * Drives how prominent the activation UI should be.
 *
 * `paused` exists because a vendor who was selling and has since been
 * restricted must NOT be shown a five-step onboarding checklist — they already
 * did all of it. They need one focused "selling is paused" message. Equally
 * they must not simply disappear from activation UI just because they once had
 * a paid order: they cannot sell right now, and that is the whole point of the
 * module.
 */
export type ActivationStage =
  | "activating" // never sold, not ready — full checklist
  | "paused" // was past onboarding, Stripe has since stopped them selling
  | "ready_no_sale" // can sell, no order yet — compact nudge
  | "complete"; // can sell and has sold — activation UI is done

export type NextAction = {
  key: MilestoneKey | "share";
  /** Short imperative for the button. */
  cta: string;
  /** One line explaining why this is next, in the vendor's own situation. */
  reason: string;
  href: string;
} | null;

export type ActivationState = {
  /**
   * False for the marketing showcase store, which never takes real orders.
   * Callers must render nothing and emit no analytics when this is false.
   */
  applicable: boolean;
  milestones: Milestone[];
  completed: number;
  total: number;
  /** THE platform requirement. Stripe charge-ready, nothing else. */
  readyToSell: boolean;
  stripe: StripeActivationState;
  stage: ActivationStage;
  nextAction: NextAction;
};

export type ActivationSeller = SellerActivationFields & {
  email: string;
  slug: string;
  emailVerified: boolean;
};

/**
 * Derive the whole activation picture. Pure — same input, same output.
 */
export function activationState(
  seller: ActivationSeller,
  facts: ActivationFacts
): ActivationState {
  const hasEverSold = facts.paidOrders > 0;
  const stripe = stripeActivationState(seller, hasEverSold);
  const readyToSell = stripe === "charge_ready";

  // "Ever published" is not cleanly derivable: a drop can go draft -> closed
  // without ever being live. A live drop now, or a completed sale, are the two
  // things that definitely prove it. This understates slightly for a vendor
  // whose only drop already closed unsold — acceptable versus adding a column
  // for a checkbox. See docs/VENDOR-ACTIVATION.md §3.4.
  const hasPublished = facts.liveDrops > 0 || hasEverSold;

  const milestones: Milestone[] = [
    // Signup captures store name, category and the Vendor Agreement, so this is
    // complete for every vendor that exists.
    { key: "account", label: "Create your account", done: true, requiredToSell: false },
    { key: "email", label: "Verify your email", done: seller.emailVerified, requiredToSell: false },
    { key: "stripe", label: "Connect Stripe", done: readyToSell, requiredToSell: true },
    {
      key: "drop",
      label: "Build your first drop",
      done: facts.dropsWithProducts > 0,
      requiredToSell: false,
    },
    { key: "publish", label: "Publish your drop", done: hasPublished, requiredToSell: false },
  ];

  const completed = milestones.filter((m) => m.done).length;

  // Order matters. Not being able to sell always outranks past success: a
  // restricted vendor with 200 orders still needs to be told their storefront
  // is down. But they get `paused`, not `activating` — re-running them through
  // an onboarding checklist they finished months ago would be insulting and
  // would bury the one thing that actually needs doing.
  const stage: ActivationStage = !readyToSell
    ? stripe === "restricted" || hasEverSold
      ? "paused"
      : "activating"
    : hasEverSold
      ? "complete"
      : "ready_no_sale";

  return {
    applicable: !isDemoStore(seller),
    milestones,
    completed,
    total: milestones.length,
    readyToSell,
    stripe,
    stage,
    nextAction: nextAction(seller, facts, stripe, milestones),
  };
}

/**
 * The one thing to do next. First match wins.
 *
 * The ordering matters more than it looks. A vendor who has built a drop but has
 * no Stripe is told *"Your drop is ready — connect Stripe to publish it"*, which
 * names their own blocked work as the reason. That is what turns the Phase A
 * publish gate from a surprise into something they were already expecting.
 */
function nextAction(
  seller: ActivationSeller,
  facts: ActivationFacts,
  stripe: StripeActivationState,
  milestones: Milestone[]
): NextAction {
  const done = (k: MilestoneKey) => milestones.find((m) => m.key === k)!.done;
  const PAYMENTS = "/dashboard/payments";

  // A suspended vendor has no self-service next step.
  if (stripe === "suspended") return null;

  if (!done("stripe")) {
    const reason =
      stripe === "restricted"
        ? "Stripe turned off card payments for your account, so your storefront isn't accepting orders."
        : facts.dropsWithProducts > 0
          ? "Your drop is ready. Connect Stripe to publish it."
          : "DropQ takes card payments through Stripe. Connect your account to start selling.";
    return {
      key: "stripe",
      cta:
        stripe === "restricted"
          ? "Fix this in Stripe"
          : stripe === "not_started"
            ? "Connect Stripe"
            : "Finish Stripe setup",
      reason,
      href: PAYMENTS,
    };
  }

  if (!done("drop")) {
    return {
      key: "drop",
      cta: "Build your first drop",
      reason: "You can take payments. Add a drop with a few items and you're selling.",
      href: "/dashboard/drops/new",
    };
  }

  if (!done("publish")) {
    return {
      key: "publish",
      cta: "Publish your drop",
      reason: "Everything's ready — publish your drop to start taking orders.",
      href: "/dashboard/drops",
    };
  }

  if (facts.paidOrders === 0) {
    return {
      key: "share",
      cta: "Share your drop link",
      reason: "You're ready to sell. Share your link to get your first order.",
      href: `/s/${seller.slug}`,
    };
  }

  // Email verification is real but never blocks selling, so it is the last
  // thing we ask for and only once commerce is working.
  if (!done("email")) {
    return {
      key: "email",
      cta: "Verify your email",
      reason: "Confirm your email address to secure your account.",
      href: "/dashboard",
    };
  }

  return null;
}

/**
 * How prominent the dashboard activation module should be. Derived here rather
 * than in the component so the rule is testable and so V.3's nudges and
 * V.Admin's view can ask the same question.
 *
 *   full    the vendor cannot sell and has never sold — show the checklist
 *   paused  they got past onboarding and Stripe has since stopped them
 *   compact they can sell — one line plus the next nudge
 *   hidden  selling and has sold, or a demo store: get out of the way
 */
export type ActivationCardMode = "full" | "paused" | "compact" | "hidden";

export function activationCardMode(state: ActivationState): ActivationCardMode {
  if (!state.applicable) return "hidden";
  switch (state.stage) {
    case "activating":
      return "full";
    case "paused":
      return "paused";
    case "ready_no_sale":
      return "compact";
    case "complete":
      return "hidden";
  }
}

/**
 * Should the dashboard's generic "Next step" card render?
 *
 * No, whenever the activation module is showing anything — otherwise a vendor
 * without Stripe sees "Connect Stripe to start selling" directly above "Your
 * drop is ready to publish", which is the exact contradiction V.2 exists to
 * remove. The activation module supersedes it; it is not an extra card.
 */
export function showsGenericNextStep(state: ActivationState): boolean {
  return activationCardMode(state) === "hidden";
}

/* --------------------------- Publish gate (V.3) --------------------------- */

/**
 * What to show instead of a Publish control when the vendor can't go live.
 * `null` means charge-ready — render publishing exactly as before.
 *
 * UX ONLY. `resolveDropStatus()` is the enforcement and is untouched: a forged
 * or stale form still gets downgraded to a draft. This exists so the vendor
 * finds out *before* clicking rather than after, which is the last remaining
 * surprise in the activation journey.
 *
 * Copy states the constraint and the next step — never an error. The
 * reassurance about drafts lives at the call site, because "your work is saved
 * as a draft" is true when creating and meaningless when reopening a closed
 * drop.
 */
export type PublishGate = { reason: string; cta: string; href: string };

export function publishGate(state: ActivationState): PublishGate | null {
  if (state.readyToSell) return null;
  const href = "/dashboard/payments";
  switch (state.stripe) {
    case "restricted":
      return {
        reason: "Payments are paused on your account, so this can't go live yet.",
        cta: "Fix this in Stripe",
        href,
      };
    case "incomplete":
    case "unknown":
      return {
        reason: "Finish your Stripe setup before this can go live.",
        cta: "Finish Stripe setup",
        href,
      };
    case "suspended":
      // Unreachable in vendor UI: getCurrentSeller() returns null for a
      // disabled seller, so requireSeller() redirects to /login before any
      // dashboard page renders. Gated anyway rather than returning null —
      // null would mean "publishing is fine", which it certainly isn't.
      return { reason: "This store can't publish right now.", cta: "Payment settings", href };
    case "not_started":
    default:
      return {
        reason: "Publishing needs Stripe. Connect your account to start taking orders.",
        cta: "Connect Stripe",
        href,
      };
  }
}

/* ------------------------- Admin outreach (V.Admin) ---------------------- */

/**
 * Who is worth an admin's attention right now.
 *
 * Deliberately three states, not a tiered scoring system. Run against the real
 * vendor population, "medium priority" was empty: every vendor without Stripe
 * had either built a drop or done nothing at all. Nobody is warming up.
 *
 * There is **no time threshold**. The trigger is demonstrated intent, not
 * elapsed time — a vendor who builds a drop two minutes after signing up is the
 * *best* person to contact, not someone to wait a day on. A vendor who signs up
 * and does nothing never reaches `needs_help`, so there is no new-signup noise
 * to suppress in the first place.
 */
export type ActivationAttention =
  | "selling_paused" // was able to sell, Stripe has stopped them — most urgent
  | "needs_help" // demonstrated intent (built a drop), can't take payment
  | "none";

export function attentionState(
  state: ActivationState,
  facts: ActivationFacts
): ActivationAttention {
  if (state.stage === "paused") return "selling_paused";
  if (!state.readyToSell && facts.dropsWithProducts > 0) return "needs_help";
  return "none";
}

/**
 * Should this seller appear in outreach lists and counts?
 *
 * Demo stores are excluded outright (`state.applicable`). Internal accounts are
 * excluded because you don't email yourself — but note `isAdmin` means "has
 * admin access", NOT "is an internal account". A real vendor granted admin
 * would silently vanish, which is why the admin page keeps a visible toggle
 * rather than hiding them for good.
 */
export function isOutreachable(
  seller: { isAdmin?: boolean },
  state: ActivationState
): boolean {
  return state.applicable && !seller.isAdmin;
}

/** Sort key: paused first, then needs-help, then everyone else. */
export function attentionRank(a: ActivationAttention): number {
  return a === "selling_paused" ? 0 : a === "needs_help" ? 1 : 2;
}

/* --------------------------------- Loader -------------------------------- */

/** The counts `activationState` needs, for one seller. */
export async function activationFacts(sellerId: string): Promise<ActivationFacts> {
  const [dropsWithProducts, liveDrops, paidOrders] = await Promise.all([
    prisma.drop.count({ where: { sellerId, products: { some: {} } } }),
    prisma.drop.count({ where: { sellerId, status: "live" } }),
    prisma.order.count({ where: { sellerId, paymentStatus: "paid" } }),
  ]);
  return { dropsWithProducts, liveDrops, paidOrders };
}

/** Convenience for a page that has the seller but not the counts. */
export async function loadActivationState(seller: ActivationSeller & { id: string }) {
  return activationState(seller, await activationFacts(seller.id));
}

export type VendorActivationRow = {
  id: string;
  storeName: string;
  slug: string;
  email: string;
  isAdmin: boolean;
  createdAt: Date;
  stripeChargesEnabledAt: Date | null;
  state: ActivationState;
  facts: ActivationFacts;
  attention: ActivationAttention;
  outreachable: boolean;
  totalDrops: number;
  draftDrops: number;
};

/**
 * Every seller with their activation picture, for the admin operations view.
 * Batched with groupBy rather than per-seller queries so it doesn't degrade
 * into N+1 as the vendor list grows.
 */
export async function loadVendorActivationRows(): Promise<VendorActivationRow[]> {
  const sellers = await prisma.seller.findMany({
    select: {
      id: true, storeName: true, slug: true, email: true, isAdmin: true,
      createdAt: true, emailVerified: true, disabledAt: true,
      stripeAccountId: true, stripeChargesEnabled: true, stripeChargesEnabledAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const [withProducts, byStatus, paid] = await Promise.all([
    prisma.drop.groupBy({
      by: ["sellerId"], where: { products: { some: {} } }, _count: true,
    }),
    prisma.drop.groupBy({ by: ["sellerId", "status"], _count: true }),
    prisma.order.groupBy({
      by: ["sellerId"], where: { paymentStatus: "paid" }, _count: true,
    }),
  ]);

  const nWithProducts = new Map(withProducts.map((r) => [r.sellerId, r._count]));
  const nPaid = new Map(paid.map((r) => [r.sellerId, r._count]));
  const nLive = new Map<string, number>();
  const nDraft = new Map<string, number>();
  const nTotal = new Map<string, number>();
  for (const r of byStatus) {
    nTotal.set(r.sellerId, (nTotal.get(r.sellerId) ?? 0) + r._count);
    if (r.status === "live") nLive.set(r.sellerId, r._count);
    if (r.status === "draft") nDraft.set(r.sellerId, r._count);
  }

  return sellers.map((s) => {
    const facts: ActivationFacts = {
      dropsWithProducts: nWithProducts.get(s.id) ?? 0,
      liveDrops: nLive.get(s.id) ?? 0,
      paidOrders: nPaid.get(s.id) ?? 0,
    };
    const state = activationState(s, facts);
    return {
      ...s,
      state,
      facts,
      attention: attentionState(state, facts),
      outreachable: isOutreachable(s, state),
      totalDrops: nTotal.get(s.id) ?? 0,
      draftDrops: nDraft.get(s.id) ?? 0,
    };
  });
}
