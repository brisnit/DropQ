"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Tip } from "@/lib/guidance";

/**
 * A smart tip — one sentence about the vendor's actual situation, plus the
 * action it implies.
 *
 * Docked to the bottom of the viewport rather than injected into the page.
 * The guidance layer lives in the dashboard LAYOUT, so an inline banner would
 * render underneath whatever page is showing, which is nowhere useful. A
 * bottom strip is in the same place on both viewports, never displaces content,
 * and is out of the way of the top-of-page primary actions.
 *
 * `role="status"` with `aria-live="polite"`: it is an advisory that appeared
 * without the vendor asking, so it should be announced once without stealing
 * focus mid-task. It is NOT a dialog and never traps focus.
 *
 * Escape dismisses, like every other piece of guidance.
 */
export function GuidanceTip({
  tip,
  onDismiss,
  onAct,
}: {
  tip: Tip;
  onDismiss: () => void;
  onAct: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const win = tip.tone === "win";

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className={`guidance-enter fixed inset-x-3 bottom-3 z-40 sm:left-auto sm:right-5 sm:bottom-5 sm:max-w-md rounded-card border shadow-[var(--shadow-lift)] p-4 flex flex-wrap items-center gap-3 ${
        win ? "bg-sage-tint border-sage/40" : "bg-paper border-line-strong"
      }`}
    >
      <p className="text-sm text-ink flex-1 min-w-[12rem]">
        {win && (
          <span aria-hidden className="mr-1.5">
            🎉
          </span>
        )}
        {tip.body}
      </p>
      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
        <Link
          href={tip.href}
          onClick={onAct}
          className="inline-flex items-center justify-center min-h-11 px-4 rounded-xl text-sm font-semibold bg-ink text-cream hover:bg-ink-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          {tip.cta} <span aria-hidden>&nbsp;&rarr;</span>
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 w-11 h-11 grid place-items-center rounded-lg text-muted hover:text-ink hover:bg-line/60 transition text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
