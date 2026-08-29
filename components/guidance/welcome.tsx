"use client";

import { useId } from "react";
import { GuidanceOverlay } from "@/components/guidance/overlay";

/**
 * The first thing a new vendor ever sees inside DropQ.
 *
 * Design constraints, in priority order:
 *
 *  1. It must never trap anyone. Two obvious exits — "Skip for now" and a real
 *     ✕ — plus Escape and a backdrop click.
 *  2. It must be readable in seconds. One sentence of what DropQ is, one of
 *     what happens next. No feature list; the tour is right there if they want
 *     detail, and the product itself teaches the rest in context.
 *  3. It must not read like software training. "Let's get you ready to make
 *     your first sale", not "Welcome to your onboarding experience".
 *
 * Shown once, ever — the stamping is handled by the host, on DISPLAY rather
 * than dismissal, so closing the tab cannot produce a second showing.
 */
export function GuidanceWelcome({
  storeName,
  onStartTour,
  onSkip,
}: {
  storeName: string;
  onStartTour: () => void;
  onSkip: (via: "skip" | "close") => void;
}) {
  const titleId = useId();

  return (
    <GuidanceOverlay onClose={() => onSkip("close")} labelledBy={titleId}>
      <div className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            Welcome to DropQ
          </p>
          <button
            type="button"
            onClick={() => onSkip("close")}
            aria-label="Close"
            className="shrink-0 -mt-2 -mr-2 w-11 h-11 grid place-items-center rounded-xl text-muted hover:text-ink hover:bg-line/60 transition text-xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            ✕
          </button>
        </div>

        <h2
          id={titleId}
          className="font-display text-2xl sm:text-[1.75rem] font-semibold leading-tight mt-2"
        >
          Let&rsquo;s get {storeName} ready to make its first sale.
        </h2>

        <p className="text-ink-soft mt-3 max-w-prose">
          DropQ turns what you make into a <b>drop</b> — one link and a QR code your
          customers order from. Most people are selling within the hour.
        </p>

        <div className="flex flex-col sm:flex-row gap-2.5 mt-7">
          <button
            type="button"
            onClick={onStartTour}
            className="inline-flex items-center justify-center min-h-12 px-6 rounded-pill bg-ink text-cream font-semibold hover:bg-ink-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            Show me around
          </button>
          <button
            type="button"
            onClick={() => onSkip("skip")}
            className="inline-flex items-center justify-center min-h-12 px-6 rounded-pill border border-line-strong bg-paper text-ink-soft font-medium hover:border-ink/30 hover:text-ink transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            Skip for now
          </button>
        </div>

        {/* The opt-in path for anyone who skips — and the reason skipping is
            genuinely costless. Without this line, "Skip" reads as "never".
            ⚠️ It must name where the tour ACTUALLY is. It said "your menu"
            while the tour lived on a temporary sidebar button; G.4 moved it
            into Help, so this moved with it. Keep the two in step. */}
        <p className="text-xs text-muted mt-4">
          Changed your mind? The tour is in{" "}
          <b className="font-semibold text-ink-soft">Help</b>, any time.
        </p>
      </div>
    </GuidanceOverlay>
  );
}
