// ---------------------------------------------------------------------------
// DropQ plans — single source of truth for tiers, limits, and gating.
// ---------------------------------------------------------------------------

export type Plan = "starter" | "growth" | "partner" | "pro";

/** Secret invite code that activates the Early Partner Program. */
export const PARTNER_INVITE_CODE =
  process.env.PARTNER_INVITE_CODE || "Droppy2181";

/** How long a Partner gets free (months) before converting to Growth. */
export const PARTNER_FREE_MONTHS = 12;

/** Starter lifetime drop allowance. */
export const STARTER_DROP_LIMIT = 4;

/**
 * Basic's cap: 24 drops per CALENDAR MONTH, resetting on the 1st.
 *
 * A different shape of limit from the free tier's, which is a lifetime count
 * held on Seller.dropsCreated. This one is derived from Drop.createdAt rather
 * than stored in a counter, for the reason the rest of this codebase prefers
 * derived values: a stored monthly counter needs a reset job, and a reset job
 * that misses a month silently locks a paying vendor out of their own product.
 * Counting rows cannot drift.
 */
export const GROWTH_MONTHLY_DROP_LIMIT = 24;

/** Paid ("Basic") subscription price (USD cents / month). */
export const GROWTH_PRICE_CENTS = 800;

/** Pro price. Displayed only — Pro is not purchasable yet (see PRICING). */
export const PRO_PRICE_CENTS = 1400;

/**
 * Pro's reduced platform fee. Everyone else pays DROPQ_FEE_PERCENT (2 by
 * default). Applied as a ceiling rather than a fixed rate, so dropping the
 * global fee below 1.5 never quietly RAISES what a Pro seller pays.
 */
export const PRO_FEE_PERCENT = 1.5;

/** The fee percent a plan pays, given the platform default. */
export function feePercentForPlan(plan: Plan, defaultPercent: number): number {
  return plan === "pro" ? Math.min(PRO_FEE_PERCENT, defaultPercent) : defaultPercent;
}

/** Stripe Price lookup key so we never hard-depend on a dashboard-created ID. */
export const GROWTH_PRICE_LOOKUP_KEY = "dropq_growth_monthly";

type SellerPlanFields = {
  plan: string;
  partnerExpiresAt: Date | null;
  dropsCreated: number;
  growthBonusUntil?: Date | null;
  /**
   * Drops this vendor created in the current calendar month.
   *
   * Optional because most callers only need the free tier's lifetime count.
   * A caller that omits it for a Basic vendor is told the limit is not
   * reached — see dropsRemaining, where that choice is argued.
   */
  dropsThisMonth?: number;
};

/** Active referral reward: free Growth-level access through growthBonusUntil. */
export function hasGrowthBonus(seller: { growthBonusUntil?: Date | null }): boolean {
  return !!seller.growthBonusUntil && new Date(seller.growthBonusUntil) > new Date();
}

/**
 * The plan a seller is actually entitled to right now. A Partner whose 12
 * months have elapsed is treated as Growth (see also the persistence in
 * convertExpiredPartners()).
 */
export function effectivePlan(seller: SellerPlanFields): Plan {
  const plan = (seller.plan as Plan) || "starter";
  if (plan === "partner" && isPartnerExpired(seller)) return "growth";
  // A referral bonus lifts a Starter to Growth-level while it's active.
  if (plan === "starter" && hasGrowthBonus(seller)) return "growth";
  return plan;
}

export function isPartnerExpired(seller: {
  partnerExpiresAt: Date | null;
}): boolean {
  return !!seller.partnerExpiresAt && new Date(seller.partnerExpiresAt) < new Date();
}

/** Lifetime drop limit for a plan (Infinity = no lifetime cap). */
export function dropLimit(plan: Plan): number {
  return plan === "starter" ? STARTER_DROP_LIMIT : Infinity;
}

/** Per-calendar-month limit for a plan (Infinity = unlimited). */
export function monthlyDropLimit(plan: Plan): number {
  return plan === "growth" ? GROWTH_MONTHLY_DROP_LIMIT : Infinity;
}

/**
 * Drops still available to a seller (Infinity = unlimited).
 *
 * Free is capped for life, Basic per month, Partner and Pro not at all.
 *
 * ⚠️ A Basic vendor's monthly figure needs `dropsThisMonth`, which only a
 * caller with database access can supply. When it is missing this returns
 * Infinity rather than zero: the cost of wrongly allowing a 25th drop is one
 * extra drop, and the cost of wrongly blocking is a paying vendor who cannot
 * use the thing they pay for. Failing toward the customer is the right way
 * round, and the enforcement path in lib/actions/dashboard.ts always passes it.
 */
export function dropsRemaining(seller: SellerPlanFields): number {
  const plan = effectivePlan(seller);

  const lifetime = dropLimit(plan);
  if (lifetime !== Infinity) return Math.max(0, lifetime - seller.dropsCreated);

  const monthly = monthlyDropLimit(plan);
  if (monthly === Infinity) return Infinity;
  if (seller.dropsThisMonth === undefined) return Infinity;
  return Math.max(0, monthly - seller.dropsThisMonth);
}

/**
 * The start of the current calendar month in a vendor's own timezone.
 *
 * "Resets on the 1st" has to mean the 1st where the vendor is standing. A
 * UTC month boundary rolls over mid-afternoon for a vendor in California,
 * which is the kind of detail nobody notices until it blocks a drop.
 */
export function monthStartFor(timezone: string | null | undefined, now = new Date()): Date {
  const tz = timezone || "America/Los_Angeles";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // Midnight local on the 1st, expressed as the UTC instant it corresponds to.
  const localNowAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = localNowAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get("year"), get("month") - 1, 1) - offset);
}

export function canCreateDrop(seller: SellerPlanFields): boolean {
  return dropsRemaining(seller) > 0;
}

/** Plans that unlock analytics + the full growth toolkit. */
export function hasGrowthFeatures(seller: SellerPlanFields): boolean {
  const p = effectivePlan(seller);
  return p === "growth" || p === "partner" || p === "pro";
}

export function planLabel(plan: Plan): string {
  // Display names only. The stored values stay starter/growth/partner/pro.
  return { starter: "Free", growth: "Basic", partner: "Partner", pro: "Pro" }[plan];
}

export function partnerExpiryFrom(start: Date): Date {
  const d = new Date(start);
  d.setMonth(d.getMonth() + PARTNER_FREE_MONTHS);
  return d;
}

// ---------------------------------------------------------------------------
// Public pricing-page content (Partner is intentionally omitted — invite only).
// ---------------------------------------------------------------------------

export type PlanCard = {
  id: Plan;
  name: string;
  positioning: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  badge?: "Most Popular" | "Coming Soon";
  cta: string;
  highlighted?: boolean;
  comingSoon?: boolean;
};

export const PRICING: PlanCard[] = [
  {
    id: "starter",
    name: "Free",
    positioning: "Try DropQ",
    price: "$0",
    cadence: "/mo",
    blurb: "Perfect for trying DropQ before committing.",
    cta: "Start free",
    features: [
      "4 drops total (lifetime — deleting or relaunching doesn't refund one)",
      "Online ordering",
      "Pickup & delivery",
      "Customer list",
      "QR code generation",
      "2% DropQ transaction fee",
    ],
  },
  {
    id: "growth",
    name: "Basic",
    positioning: "Run Drops",
    price: "$8",
    cadence: "/mo",
    blurb: "The ideal plan for businesses actively selling through DropQ.",
    badge: "Most Popular",
    highlighted: true,
    cta: "Upgrade to Basic",
    features: [
      "24 drops a month",
      "Online ordering",
      "Pickup & delivery",
      "Customer list",
      "QR codes",
      "Customer signups (email + SMS)",
      "Basic sales analytics",
      "Sales by drop",
      "Sales by product",
      "Repeat customer tracking",
      "Shareable drop links",
      "2% DropQ transaction fee",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    positioning: "Grow Customers",
    price: "$14",
    cadence: "/mo",
    blurb: "For sellers leaning on repeat customers.",
    badge: "Coming Soon",
    comingSoon: true,
    cta: "Coming Soon",
    features: [
      "Everything in Basic",
      "Reduced transaction fee (1.5%)",
      "Advanced analytics dashboard",
      "Customer lifetime value tracking",
      "Automated repeat-customer reminders",
      "Customer & sales data exports",
      "Priority support",
      "Early access features",
    ],
  },
];
