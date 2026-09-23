/**
 * Every value shown in the /vendor-demo walkthrough.
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────
 *
 * The demo shows a vendor "18 / 24 remaining · 6 orders · $84 sold". Those
 * numbers look exactly like the real ones on the dashboard, and that is the
 * point — but it also means that if they ever leaked into a real surface, or a
 * real figure ever leaked in here, nobody would notice by looking.
 *
 * So every fictional value lives here, prefixed DEMO_, in a module that imports
 * nothing. It cannot read the database, it cannot call Stripe, and a self-test
 * asserts the walkthrough renders no value that is not defined in this file.
 *
 * ── THE NAMES ARE INVENTED ON PURPOSE ─────────────────────────────────────
 *
 * "Luna's Kitchen" and the four buyers are fiction, chosen not to collide with
 * any real DropQ vendor. This page is shown to strangers at a market, so it
 * must be impossible for it to display a real vendor's store or a real
 * customer's name. The same rule the Help screenshots follow.
 */

/** Stamped into the DOM so the self-test can prove which surface it is on. */
export const DEMO_MARKER = "vendor-demo";

/* ------------------------------------------------------- the business ---- */

export const DEMO_BUSINESS = {
  name: "Luna's Kitchen",
  category: "Cottage food · Bakery",
  location: "San Diego, CA",
  /** The handle a real vendor would get; never resolves to a live store. */
  storefront: "drop-q.com/s/lunas-kitchen",
} as const;

/* ------------------------------------------------------------ the drop --- */

export const DEMO_DROP = {
  title: "Saturday Sourdough Drop",
  productName: "Classic Country Sourdough",
  productBlurb: "Naturally fermented, baked Saturday morning.",
  price: "$14",
  priceCents: 1400,
  quantity: 24,
  pickupDay: "Saturday",
  pickupWindow: "9:00 AM – 12:00 PM",
  pickupPlace: "Little Italy Farmers Market",
} as const;

/* ----------------------------------------------------- the drop, live ---- */

/**
 * What the vendor sees once it is selling. Deliberately NOT a round number of
 * orders times a round price: a made-up dashboard that adds up too neatly is
 * the thing that makes a demo feel like a mock-up.
 */
export const DEMO_RESULTS = {
  sold: 6,
  remaining: 18,
  orders: 4,
  revenue: "$84",
} as const;

export const DEMO_ORDERS = [
  { name: "Maya", loaves: 2, status: "Paid" },
  { name: "Carlos", loaves: 1, status: "Paid" },
  { name: "Jenna", loaves: 1, status: "Paid" },
  { name: "Andre", loaves: 2, status: "Paid" },
] as const;

/** Every number the results panel prints, so a test can assert the set. */
export const DEMO_NUMERIC_STRINGS = [
  String(DEMO_RESULTS.sold),
  String(DEMO_RESULTS.remaining),
  String(DEMO_RESULTS.orders),
  DEMO_RESULTS.revenue,
  DEMO_DROP.price,
  String(DEMO_DROP.quantity),
] as const;

/* -------------------------------------------------------- the journey ---- */

export type DemoStepKey =
  | "welcome"
  | "business"
  | "stripe"
  | "drop"
  | "storefront"
  | "order"
  | "dashboard";

export type DemoStep = {
  key: DemoStepKey;
  /** The chrome the phone wears: vendor app, or the customer's view. */
  side: "vendor" | "customer";
  /** Label above the phone, so it is never ambiguous whose screen this is. */
  perspective: string;
  title: string;
  body: string;
  /** The button that advances. Written as the product would write it. */
  cta: string;
};

/**
 * The seven screens, following the real six-step vendor tour in lib/guidance.ts
 * but rearranged for a stranger rather than a signed-up vendor: it opens on
 * welcome, and it ends on proof rather than on "then share it", because the
 * question this page answers is "would this work for me", not "what do I do
 * next".
 */
export const DEMO_STEPS: readonly DemoStep[] = [
  {
    key: "welcome",
    side: "vendor",
    perspective: "Your side",
    title: "Welcome to DropQ",
    body: "Let's get you ready to sell. Six taps — nothing here is real, and nothing gets saved.",
    cta: "Let's go",
  },
  {
    key: "business",
    side: "vendor",
    perspective: "Your side",
    title: "Your business",
    body: "Name it, say what you make, and you have a store. You can change any of it later.",
    cta: "Next",
  },
  {
    key: "stripe",
    side: "vendor",
    perspective: "Your side",
    title: "Get paid directly",
    body: "Connect Stripe so customer payments go straight to your own account. DropQ never holds your money.",
    cta: "Connect Stripe",
  },
  {
    key: "drop",
    side: "vendor",
    perspective: "Your side",
    title: "Your first drop",
    body: "What you're selling, how many, and where they collect it. That's a drop.",
    cta: "Preview my drop",
  },
  {
    key: "storefront",
    side: "customer",
    perspective: "What your customers see",
    title: "Share one link",
    body: "No app to download, no account to make. They tap the link and order.",
    cta: "Order one",
  },
  {
    key: "order",
    side: "customer",
    perspective: "What your customers see",
    title: "They order in seconds",
    body: "Card payment, straight to your Stripe account. They get a confirmation; you get the order.",
    cta: "Back to your side",
  },
  {
    key: "dashboard",
    side: "vendor",
    perspective: "Your side",
    title: "Your drop is working",
    body: "Every order in one place, counted as they come in. You bake — DropQ keeps the queue.",
    cta: "That's the whole thing",
  },
] as const;

export const DEMO_STEP_COUNT = DEMO_STEPS.length;

/* ---------------------------------------------------------- marketing ---- */

/** Kept short on purpose: this is read standing up, at a market stall. */
export const DEMO_MODEL = [
  {
    n: "1",
    title: "Connect",
    body: "Create your store and connect Stripe. Payments land in your own account.",
  },
  {
    n: "2",
    title: "Drop",
    body: "Add what you're making, set how many, choose pickup. Publish.",
  },
  {
    n: "3",
    title: "Sell",
    body: "Share the link. Orders come in counted, paid and in one list.",
  },
] as const;

/**
 * Who it is for.
 *
 * Phrased as the people themselves, not as market segments — a baker at a stall
 * recognises "bakers", not "the cottage food vertical".
 */
export const DEMO_AUDIENCE = [
  "Bakers",
  "Cottage food makers",
  "Farmers-market vendors",
  "Meal preppers",
  "Pop-up chefs",
  "Specialty food makers",
  "Makers and artists",
  "Anything limited-run",
] as const;
