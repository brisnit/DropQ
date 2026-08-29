import { HELP_ARTICLES } from "@/lib/help/content";
import { routeMatches } from "@/lib/guidance";
import type { GuidanceCapabilities } from "@/lib/guidance";
import { bodyText, type HelpArticle, type HelpRequires } from "@/lib/help/types";

/**
 * Help search and filtering. Pure, deterministic, and deliberately not clever.
 *
 * A scoring pass over ~45 articles runs in well under a millisecond, so there
 * is no index to build, no service to run, and nothing to keep in sync. It also
 * means the results are explainable: a vendor who searches "stripe" gets the
 * Stripe articles because their titles and keywords say Stripe, not because a
 * model decided so.
 *
 * ⚠️ NOTHING HERE LOGS. The caller reports `queryLength`, `resultCount` and
 * `zeroResults` — never the query itself. See lib/analytics.ts.
 */

/** Which articles this vendor may see, given what they can actually use. */
export function availableArticles(caps: GuidanceCapabilities): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => !a.requires || hasCapability(a.requires, caps));
}

export function hasCapability(need: HelpRequires, caps: GuidanceCapabilities): boolean {
  switch (need) {
    case "walkup":
      return caps.walkUp;
    case "dropmeet":
      return caps.dropMeet;
    case "growth":
      return caps.growthFeatures;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();

/** Words worth matching on. Drops the noise that would match everything. */
const STOP = new Set([
  "a", "an", "the", "is", "are", "do", "does", "i", "my", "me", "to", "of", "in",
  "on", "for", "how", "what", "why", "can", "and", "it", "this", "that",
]);

function terms(q: string): string[] {
  return norm(q).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
}

function articleText(a: HelpArticle): string {
  return norm(
    `${a.title} ${a.question} ${a.summary} ${a.keywords.join(" ")} ${bodyText(a.body)}`
  );
}

/**
 * Weights, highest first: an exact phrase in the title or question is the
 * strongest possible signal, and body text the weakest — otherwise a long
 * article that mentions Stripe once outranks the article *about* Stripe.
 */
const W = { titlePhrase: 100, questionPhrase: 60, keywordExact: 40, titleTerm: 18, keywordTerm: 12, summaryTerm: 6, bodyTerm: 2, routeBonus: 25 };

export type HelpSearchResult = { article: HelpArticle; score: number };

export function searchHelp(
  query: string,
  caps: GuidanceCapabilities,
  pathname?: string
): HelpSearchResult[] {
  const q = norm(query);
  if (!q) return [];
  const ts = terms(query);
  const results: HelpSearchResult[] = [];

  for (const a of availableArticles(caps)) {
    const title = norm(a.title);
    const question = norm(a.question);
    const summary = norm(a.summary);
    const keys = a.keywords.map(norm);
    const text = articleText(a);
    let score = 0;

    if (title.includes(q)) score += W.titlePhrase;
    if (question.includes(q)) score += W.questionPhrase;
    if (keys.some((k) => k === q)) score += W.keywordExact;

    for (const t of ts) {
      if (title.includes(t)) score += W.titleTerm;
      if (keys.some((k) => k.includes(t))) score += W.keywordTerm;
      if (summary.includes(t)) score += W.summaryTerm;
      else if (text.includes(t)) score += W.bodyTerm;
    }

    // A little nudge for where the vendor is standing, never a filter.
    if (score > 0 && pathname && a.routes?.some((r) => routeMatches(r, pathname))) {
      score += W.routeBonus;
    }
    if (score > 0) results.push({ article: a, score });
  }

  return results.sort(
    (x, y) => y.score - x.score || x.article.priority - y.article.priority
  );
}

/**
 * Articles relevant to the page the vendor is on.
 *
 * A suggestion, not a filter: the panel shows these first and every category
 * underneath, so contextual help never hides the rest of Help.
 */
export function articlesForRoute(
  pathname: string,
  caps: GuidanceCapabilities
): HelpArticle[] {
  return availableArticles(caps)
    .filter((a) => a.routes?.some((r) => routeMatches(r, pathname)))
    .sort((a, b) => a.priority - b.priority);
}

export function articleBySlug(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}

export function relatedArticles(a: HelpArticle, caps: GuidanceCapabilities): HelpArticle[] {
  const allowed = new Set(availableArticles(caps).map((x) => x.slug));
  return a.related
    .filter((s) => allowed.has(s))
    .map((s) => articleBySlug(s))
    .filter((x): x is HelpArticle => !!x);
}
