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

/** Growth subscription price (USD cents / month). */
export const GROWTH_PRICE_CENTS = 2000;

/** Stripe Price lookup key so we never hard-depend on a dashboard-created ID. */
export const GROWTH_PRICE_LOOKUP_KEY = "dropq_growth_monthly";

type SellerPlanFields = {
  plan: string;
  partnerExpiresAt: Date | null;
  dropsCreated: number;
};

/**
 * The plan a seller is actually entitled to right now. A Partner whose 12
 * months have elapsed is treated as Growth (see also the persistence in
 * convertExpiredPartners()).
 */
export function effectivePlan(seller: SellerPlanFields): Plan {
  const plan = (seller.plan as Plan) || "starter";
  if (plan === "partner" && isPartnerExpired(seller)) return "growth";
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
  return { starter: "Starter", growth: "Growth", partner: "Partner", pro: "Pro" }[plan];
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
    name: "Starter",
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
    name: "Growth",
    positioning: "Run Drops",
    price: "$20",
    cadence: "/mo",
    blurb: "The ideal plan for businesses actively selling through DropQ.",
    badge: "Most Popular",
    highlighted: true,
    cta: "Upgrade to Growth",
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
    price: "$99",
    cadence: "/mo",
    blurb: "Automated repeat-customer growth for power sellers.",
    badge: "Coming Soon",
    comingSoon: true,
    cta: "Coming Soon",
    features: [
      "Everything in Growth",
      "Advanced analytics dashboard",
      "Quarterly sales reporting",
      "Customer lifetime value tracking",
      "Automated 30-day reminders",
      "Automated 90-day reminders",
      "Geofencing notifications",
      "Priority support",
      "Multiple team members",
      "Multiple locations",
      "White-label customer experience",
      "Customer & sales data exports",
      "Early access features",
      "Reduced transaction fee (1.5%)",
    ],
  },
];
