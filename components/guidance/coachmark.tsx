"use client";

import { useEffect, useId, useRef } from "react";
import type { AnchorId } from "@/lib/guidance";
import { useAnchorPlacement } from "@/components/guidance/use-anchor";
import { bubbleStyle, DOCK_BREAKPOINT } from "@/components/guidance/position";

/**
 * A single explanation, anchored beside the thing it explains.
 *
 * Deliberately NOT modal, and deliberately not built on GuidanceOverlay:
 *
 *  - no focus trap. A coachmark describes a control; trapping focus would stop
 *    the vendor using it. Focus moves to the bubble so a keyboard user meets it
 *    where it appears, and Tab then continues into the page.
 *  - `role="note"`, not `dialog`. It is an aside, not a task.
 *  - no backdrop. Nothing behind it is blocked.
 *
 * Escape dismisses. Resize and scroll reposition. If the anchor is missing from
 * the DOM the bubble renders nothing at all rather than floating in a corner
 * explaining an element that isn't there — unlike a tour step, which docks,
 * because a coachmark with no subject has nothing to say.
 *
 * Below 640px it docks to the bottom of the viewport instead of floating: see
 * position.ts for why.
 *
 * PHASE NOTE: still unmounted. Phase 3 wires these; G.2 uses the shared
 * anchoring hook for the tour only.
 */
export function Coachmark({
  anchor,
  title,
  body,
  onDismiss,
  dismissLabel = "Got it",
}: {
  anchor: AnchorId;
  title: string;
  body: string;
  onDismiss: () => void;
  dismissLabel?: string;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const { placement, found } = useAnchorPlacement(anchor, bubbleRef);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  useEffect(() => {
    if (found) bubbleRef.current?.focus();
  }, [found]);

  if (found === false) return null;

  const { docked, style } = bubbleStyle(placement, found);

  return (
    <div
      ref={bubbleRef}
      role="note"
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      style={style}
      className={
        docked
          ? "guidance-enter fixed inset-x-3 bottom-3 z-50 max-w-md mx-auto bg-paper border border-line-strong rounded-card shadow-[var(--shadow-lift)] p-4 focus:outline-none"
          : `guidance-enter fixed z-50 w-[320px] bg-paper border border-line-strong rounded-card shadow-[var(--shadow-lift)] p-4 focus:outline-none ${
              placement ? "" : "invisible"
            }`
      }
    >
      <div className="flex items-start justify-between gap-3">
        <p id={titleId} className="font-display font-semibold text-[0.98rem] leading-snug">
          {title}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 -mt-1 -mr-1 w-9 h-9 grid place-items-center rounded-lg text-muted hover:text-ink hover:bg-line/60 transition text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          ✕
        </button>
      </div>
      <p id={bodyId} className="text-sm text-ink-soft mt-1.5">
        {body}
      </p>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center justify-center min-h-11 px-4 py-2 rounded-xl text-sm font-semibold bg-ink text-cream hover:bg-ink-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          {dismissLabel}
        </button>
      </div>
    </div>
  );
}

/** Re-exported so call sites don't need to know where the constant lives. */
export { DOCK_BREAKPOINT };
