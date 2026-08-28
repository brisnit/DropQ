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
export const STARTER_DROP_LIMIT = 3;

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

/** Lifetime drop limit for a plan (Infinity = unlimited). */
export function dropLimit(plan: Plan): number {
  return plan === "starter" ? STARTER_DROP_LIMIT : Infinity;
}

/** Drops still available to a seller (Infinity = unlimited). */
export function dropsRemaining(seller: SellerPlanFields): number {
  const limit = dropLimit(effectivePlan(seller));
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - seller.dropsCreated);
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
      "3 drops total (lifetime)",
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
      "Unlimited drops",
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
