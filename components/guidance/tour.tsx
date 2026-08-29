"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { TOUR_STEPS, TOUR_LENGTH, safeTourStep } from "@/lib/guidance";
import { useAnchorPlacement } from "@/components/guidance/use-anchor";
import { bubbleStyle } from "@/components/guidance/position";

/**
 * The six-step orientation tour.
 *
 * ORIENTATION, NOT TRAINING. Each step says what a part of DropQ is for and
 * moves on. Dates, inventory, drop modes, QR codes and publishing are all
 * taught in context by Phase 3's coachmarks, at the moment the vendor reaches
 * them — teaching them here would be a lecture before the work.
 *
 * WHY IT DOCKS INSTEAD OF SKIPPING. Three of the six steps point at sidebar nav
 * items, and the sidebar is `hidden md:flex` — on a phone those elements are
 * inside a closed menu and genuinely absent from the DOM. Skipping a step whose
 * anchor is missing would drop half the tour on exactly the device most DropQ
 * vendors use at a market. Instead the step docks to the bottom of the screen
 * and keeps its copy: on desktop the tour points at the real interface, on
 * mobile it reads as a short sequence of cards. Same six steps either way.
 *
 * Not modal: a tour step is a coachmark with chrome, and trapping focus would
 * stop the vendor looking at the thing being described. Escape skips.
 */
export function GuidanceTour({
  step,
  onStep,
  onFinish,
}: {
  step: number;
  onStep: (next: number) => void;
  onFinish: (outcome: "completed" | "skipped") => void;
}) {
  const index = safeTourStep(step);
  const current = TOUR_STEPS[index];
  const bubbleRef = useRef<HTMLDivElement>(null);
  const { placement, found } = useAnchorPlacement(current.anchor, bubbleRef);
  const titleId = useId();
  const bodyId = useId();

  const isLast = index === TOUR_LENGTH - 1;
  const next = useCallback(() => {
    if (isLast) onFinish("completed");
    else onStep(index + 1);
  }, [isLast, index, onFinish, onStep]);
  const back = useCallback(() => {
    if (index > 0) onStep(index - 1);
  }, [index, onStep]);

  // Keyboard: arrows move, Escape skips. Registered on the document rather than
  // the bubble because focus deliberately isn't trapped here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onFinish("skipped");
        return;
      }
      // Don't hijack arrow keys while someone is typing in a field.
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, back, onFinish]);

  // Move focus to each new step so a screen reader announces it and the Next
  // button is one Tab away. Keyed on index so it re-fires as steps advance.
  useEffect(() => {
    bubbleRef.current?.focus();
  }, [index]);

  const { docked, style } = bubbleStyle(placement, found);

  return (
    <div
      ref={bubbleRef}
      role="note"
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      style={docked ? undefined : style}
      className={
        docked
          ? "guidance-enter fixed inset-x-3 bottom-3 z-50 max-w-md mx-auto bg-paper border border-line-strong rounded-card shadow-[var(--shadow-lift)] p-4 sm:p-5 focus:outline-none"
          : `guidance-enter fixed z-50 w-[320px] bg-paper border border-line-strong rounded-card shadow-[var(--shadow-lift)] p-4 focus:outline-none ${
              placement ? "" : "invisible"
            }`
      }
    >
      <div className="flex items-start justify-between gap-3">
        <p id={titleId} className="font-display font-semibold text-[1.02rem] leading-snug">
          {current.title}
        </p>
        <button
          type="button"
          onClick={() => onFinish("skipped")}
          aria-label="Close tour"
          className="shrink-0 -mt-1.5 -mr-1.5 w-10 h-10 grid place-items-center rounded-lg text-muted hover:text-ink hover:bg-line/60 transition text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          ✕
        </button>
      </div>

      <p id={bodyId} className="text-sm text-ink-soft mt-1.5">
        {current.body}
      </p>

      {/* Only when the anchor isn't on screen. A step that can't point at
          anything must say how to reach the thing instead. */}
      {docked && current.dockedNote && (
        <p className="text-xs text-muted mt-2 bg-cream border border-line rounded-lg px-2.5 py-2">
          {current.dockedNote}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted tabular-nums shrink-0" aria-live="polite">
          {index + 1} of {TOUR_LENGTH}
        </p>
        <div className="flex gap-2">
          {index > 0 && (
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center justify-center min-h-11 px-4 rounded-xl text-sm font-medium border border-line-strong bg-paper text-ink-soft hover:border-ink/30 hover:text-ink transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={next}
            className="inline-flex items-center justify-center min-h-11 px-5 rounded-xl text-sm font-semibold bg-ink text-cream hover:bg-ink-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            {isLast ? "Done" : "Next"}
          </button>
        </div>
      </div>

      {!isLast && (
        <div className="mt-3 pt-3 border-t border-line flex justify-center">
          <button
            type="button"
            onClick={() => onFinish("skipped")}
            className="text-xs font-medium text-muted hover:text-ink underline underline-offset-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            Skip tour
          </button>
        </div>
      )}
    </div>
  );
}
