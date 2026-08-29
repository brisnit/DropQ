"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GuidanceOverlay } from "@/components/guidance/overlay";
import { CATEGORY_LABELS, CATEGORY_ORDER, type HelpArticle } from "@/lib/help/types";
import { availableArticles, articlesForRoute, searchHelp, relatedArticles } from "@/lib/help/search";
import { trackGuidance } from "@/lib/analytics";
import { startTourAction, markHelpOpenedAction } from "@/lib/actions/guidance";
import { START_TOUR_EVENT, type GuidanceCapabilities } from "@/lib/guidance";

/**
 * The in-app Help panel.
 *
 * A drawer, not a page: a vendor asking "what does publishing do?" is in the
 * middle of publishing, and navigating them away to find out is the thing this
 * is supposed to fix. The full /help route exists for links and for reading
 * outside the dashboard.
 *
 * ⚠️ PRIVACY. `help_searched` reports `queryLength`, `resultCount` and
 * `zeroResults` — never the text typed. The event's props type makes a `query`
 * field a compile error; this component simply never has one to pass.
 */
export function HelpPanel({
  capabilities,
  tourLabel,
  onClose,
}: {
  capabilities: GuidanceCapabilities;
  tourLabel: string;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<HelpArticle | null>(null);
  const titleId = useId();

  useEffect(() => {
    trackGuidance("help_opened", { from: "header" });
    void markHelpOpenedAction().catch(() => {});
  }, []);

  const all = useMemo(() => availableArticles(capabilities), [capabilities]);
  const contextual = useMemo(
    () => articlesForRoute(pathname, capabilities).slice(0, 4),
    [pathname, capabilities]
  );
  const results = useMemo(
    () => (query.trim() ? searchHelp(query, capabilities, pathname) : null),
    [query, capabilities, pathname]
  );

  // Report the shape of a search, never its content, and only once it settles.
  useEffect(() => {
    if (!results) return;
    const t = setTimeout(
      () =>
        trackGuidance("help_searched", {
          queryLength: query.trim().length,
          resultCount: results.length,
          zeroResults: results.length === 0,
        }),
      600
    );
    return () => clearTimeout(t);
  }, [results, query]);

  const openArticle = (a: HelpArticle, from: "panel" | "search" | "related") => {
    trackGuidance("help_article_viewed", { slug: a.slug, from });
    setOpen(a);
  };

  return (
    <GuidanceOverlay variant="drawer" onClose={onClose} labelledBy={titleId}>
      <div className="sticky top-0 bg-paper border-b border-line px-5 py-4 flex items-center justify-between gap-3 z-10">
        <h2 id={titleId} className="font-display text-lg font-semibold">
          {open ? "Help" : "How can we help?"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help"
          className="shrink-0 -mr-2 w-11 h-11 grid place-items-center rounded-xl text-muted hover:text-ink hover:bg-line/60 transition text-xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          ✕
        </button>
      </div>

      {open ? (
        <ArticleView
          article={open}
          capabilities={capabilities}
          onBack={() => setOpen(null)}
          onOpen={(a) => openArticle(a, "related")}
        />
      ) : (
        <div className="p-5 space-y-6">
          <label className="block">
            <span className="sr-only">Search help</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search help…"
              className="w-full bg-paper border border-line-strong rounded-xl px-3.5 py-2.5 text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>

          {results ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                {results.length === 0
                  ? "No matches"
                  : `${results.length} result${results.length === 1 ? "" : "s"}`}
              </h3>
              {results.length === 0 ? (
                <p className="text-sm text-muted">
                  Nothing matched that. Try a word you&apos;d use for the thing itself —
                  &ldquo;stripe&rdquo;, &ldquo;qr&rdquo;, &ldquo;inventory&rdquo; — or browse the
                  categories below.
                </p>
              ) : (
                <ul className="space-y-1">
                  {results.map(({ article }) => (
                    <ArticleRow
                      key={article.id}
                      article={article}
                      onClick={() => openArticle(article, "search")}
                    />
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <>
              {contextual.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                    On this page
                  </h3>
                  <ul className="space-y-1">
                    {contextual.map((a) => (
                      <ArticleRow key={a.id} article={a} onClick={() => openArticle(a, "panel")} />
                    ))}
                  </ul>
                </section>
              )}

              {CATEGORY_ORDER.map((cat) => {
                const items = all
                  .filter((a) => a.category === cat)
                  .sort((x, y) => x.priority - y.priority);
                if (items.length === 0) return null;
                return (
                  <section key={cat}>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                      {CATEGORY_LABELS[cat]}
                    </h3>
                    <ul className="space-y-1">
                      {items.map((a) => (
                        <ArticleRow key={a.id} article={a} onClick={() => openArticle(a, "panel")} />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </>
          )}

          <div className="pt-4 border-t border-line space-y-3">
            <button
              type="button"
              onClick={() => {
                trackGuidance("onboarding_tour_started", { from: "help" });
                onClose();
                void startTourAction()
                  .then(() => window.dispatchEvent(new CustomEvent(START_TOUR_EVENT)))
                  .catch(() => {});
              }}
              className="w-full text-center border border-line-strong rounded-xl px-3 py-2.5 text-sm font-medium text-ink hover:bg-line/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              {tourLabel}
            </button>
            <Link
              href="/help"
              onClick={onClose}
              className="block text-center text-sm text-muted hover:text-ink"
            >
              Open the full help centre ↗
            </Link>
          </div>
        </div>
      )}
    </GuidanceOverlay>
  );
}

function ArticleRow({ article, onClick }: { article: HelpArticle; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-line/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <span className="block text-sm font-medium text-ink">{article.title}</span>
        <span className="block text-xs text-muted mt-0.5">{article.summary}</span>
      </button>
    </li>
  );
}

function ArticleView({
  article,
  capabilities,
  onBack,
  onOpen,
}: {
  article: HelpArticle;
  capabilities: GuidanceCapabilities;
  onBack: () => void;
  onOpen: (a: HelpArticle) => void;
}) {
  const related = relatedArticles(article, capabilities);
  return (
    <div className="p-5">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-muted hover:text-ink mb-4 inline-flex items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <span aria-hidden>←</span> All help
      </button>
      <h3 className="font-display text-xl font-semibold leading-snug">{article.title}</h3>
      <p className="text-sm text-muted mt-1">{article.question}</p>
      <div className="mt-4 space-y-3">
        <HelpBody article={article} />
      </div>
      {related.length > 0 && (
        <div className="mt-7 pt-4 border-t border-line">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Related
          </h4>
          <ul className="space-y-1">
            {related.map((a) => (
              <ArticleRow key={a.id} article={a} onClick={() => onOpen(a)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function HelpBody({ article }: { article: HelpArticle }) {
  return (
    <>
      {article.body.map((b, i) => {
        if (b.kind === "p") {
          return (
            <p key={i} className="text-[0.95rem] text-ink-soft leading-relaxed">
              {b.text}
            </p>
          );
        }
        if (b.kind === "steps") {
          return (
            <ol key={i} className="list-decimal pl-5 space-y-1.5 text-[0.95rem] text-ink-soft">
              {b.items.map((it, j) => (
                <li key={j}>{it}</li>
              ))}
            </ol>
          );
        }
        return (
          <p
            key={i}
            className="text-sm text-ink-soft bg-cream border-l-2 border-brand rounded-r-lg px-3.5 py-2.5"
          >
            {b.text}
          </p>
        );
      })}
    </>
  );
}
