import type { GuidanceTier } from "@/lib/guidance";

/**
 * The Help Center's content model.
 *
 * ONE source of truth, deliberately. The same array powers the in-app panel,
 * the public /help pages, search, contextual suggestions, and — later — the
 * illustrated walkthroughs and anything that wants to answer vendor questions.
 * Hard-coding copy into accordions would make each of those a separate,
 * separately-wrong body of text.
 *
 * ⚠️ `verifiedAgainst` is not documentation of the documentation. It names the
 * code each answer was checked against, so when that code changes there is a
 * mechanical way to find the articles that just became wrong. An article
 * without it does not ship — the content self-test refuses.
 */

export type HelpCategory =
  | "getting-started"
  | "drops"
  | "products"
  | "payments"
  | "orders"
  | "sharing"
  | "customers"
  | "dropmeet"
  | "walkup"
  | "account"
  | "troubleshooting";

export const CATEGORY_LABELS: Record<HelpCategory, string> = {
  "getting-started": "Getting started",
  drops: "Creating drops",
  products: "Products",
  payments: "Payments & Stripe",
  orders: "Orders",
  sharing: "QR codes & sharing",
  customers: "Customers",
  dropmeet: "DropMeet",
  walkup: "Walk-up sales",
  account: "Account & plan",
  troubleshooting: "Troubleshooting",
};

/** Categories in the order the panel lists them. */
export const CATEGORY_ORDER: HelpCategory[] = [
  "getting-started",
  "drops",
  "products",
  "payments",
  "orders",
  "sharing",
  "customers",
  "dropmeet",
  "walkup",
  "account",
  "troubleshooting",
];

export type HelpBlock =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "note"; text: string };

/**
 * A capability an article depends on.
 *
 * Resolved against `GuidanceCapabilities`, which the server fills from the same
 * gates the features themselves use. An article about a button the vendor does
 * not have is worse than no article: it makes DropQ look broken.
 */
export type HelpRequires = "walkup" | "dropmeet" | "growth";

export type HelpArticle = {
  id: string;
  slug: string;
  /** Short noun phrase, used as the heading. */
  title: string;
  /** The same thing as a vendor would ask it. Weighted heavily in search. */
  question: string;
  /** One sentence, shown in listings and search results. */
  summary: string;
  category: HelpCategory;
  keywords: string[];
  body: HelpBlock[];
  /** Slugs. Validated by the content self-test. */
  related: string[];
  /** Dashboard routes where this article is contextually relevant. */
  routes?: string[];
  audience?: GuidanceTier[];
  requires?: HelpRequires;
  /** Lower sorts first within a category. */
  priority: number;
  /** The code this answer was verified against. Required. */
  verifiedAgainst: string;
};

export const p = (text: string): HelpBlock => ({ kind: "p", text });
export const steps = (...items: string[]): HelpBlock => ({ kind: "steps", items });
export const note = (text: string): HelpBlock => ({ kind: "note", text });
