/**
 * Where to put a coachmark bubble relative to the element it points at.
 *
 * Pure geometry, no DOM: the caller measures, this decides. That is what makes
 * "does a coachmark ever cover the button it is describing?" a question with a
 * test rather than a question with a screenshot.
 *
 * ⚠️ No "use client" — a pure module, imported by the client bubble AND by the
 * self-test route.
 */

export type Rect = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Viewport = { width: number; height: number };

export type Placement =
  /** Pinned to the bottom of the viewport, full width. Phones. */
  | { mode: "docked" }
  /** Floating beside the anchor. */
  | { mode: "floating"; side: "top" | "bottom" | "left" | "right"; top: number; left: number };

/**
 * Below this width a floating bubble cannot be placed without either covering
 * the anchor or being clipped, so we stop trying. Vendors run DropQ from
 * phones at markets; a bubble that covers the button they are reaching for is
 * worse than no bubble at all.
 */
export const DOCK_BREAKPOINT = 640;

/** Space between the anchor and the bubble. */
const GAP = 10;
/** Never let the bubble touch the viewport edge. */
const MARGIN = 12;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/**
 * Preference order is below → above → right → left.
 *
 * Below first because reading order puts explanation after the thing being
 * explained, and because the top of a dashboard page is where the sticky
 * header lives. A side is only chosen if the bubble genuinely fits there; if
 * none fits, we dock rather than render something clipped.
 */
export function computePlacement(
  anchor: Rect,
  bubble: Size,
  viewport: Viewport
): Placement {
  if (viewport.width < DOCK_BREAKPOINT) return { mode: "docked" };

  // A bubble that is simply too big for the viewport in either axis can never
  // be placed without clipping, whichever side we pick. Checked up front
  // because the side placements below only reason about the horizontal axis:
  // without this, a very tall bubble beside a left-edge anchor "fits right"
  // and then runs off the top and bottom of the screen.
  const fitsOnScreen =
    bubble.height + 2 * MARGIN <= viewport.height && bubble.width + 2 * MARGIN <= viewport.width;
  if (!fitsOnScreen) return { mode: "docked" };

  const fitsBelow = anchor.top + anchor.height + GAP + bubble.height + MARGIN <= viewport.height;
  const fitsAbove = anchor.top - GAP - bubble.height - MARGIN >= 0;
  const fitsRight = anchor.left + anchor.width + GAP + bubble.width + MARGIN <= viewport.width;
  const fitsLeft = anchor.left - GAP - bubble.width - MARGIN >= 0;

  const maxLeft = viewport.width - bubble.width - MARGIN;
  const maxTop = viewport.height - bubble.height - MARGIN;

  // Horizontally centred on the anchor, then pulled inside the viewport.
  //
  // EXCEPT for a much wider anchor — a full-width section label, say. Centring
  // under one of those parks the bubble in the middle of whatever the label
  // introduces (the date picker, the item rows), hiding the thing the vendor
  // is being told about. Aligning to the anchor's start reads as attached to
  // the label and leaves the content beside it visible.
  const wideAnchor = anchor.width > bubble.width * 1.5;
  const centeredLeft = clamp(
    wideAnchor ? anchor.left : anchor.left + anchor.width / 2 - bubble.width / 2,
    MARGIN,
    Math.max(MARGIN, maxLeft)
  );
  // Vertically centred, same treatment.
  const centeredTop = clamp(
    anchor.top + anchor.height / 2 - bubble.height / 2,
    MARGIN,
    Math.max(MARGIN, maxTop)
  );

  if (fitsBelow) {
    return { mode: "floating", side: "bottom", top: anchor.top + anchor.height + GAP, left: centeredLeft };
  }
  if (fitsAbove) {
    return { mode: "floating", side: "top", top: anchor.top - GAP - bubble.height, left: centeredLeft };
  }
  if (fitsRight) {
    return { mode: "floating", side: "right", top: centeredTop, left: anchor.left + anchor.width + GAP };
  }
  if (fitsLeft) {
    return { mode: "floating", side: "left", top: centeredTop, left: anchor.left - GAP - bubble.width };
  }
  return { mode: "docked" };
}

/**
 * Does a placement overlap the element it describes?
 *
 * Should always be false for a floating placement — asserted by the self-test
 * across a grid of anchor positions and viewport sizes, because this is the
 * failure that makes guidance actively harmful rather than merely unhelpful.
 */
export function overlapsAnchor(placement: Placement, anchor: Rect, bubble: Size): boolean {
  if (placement.mode === "docked") return false;
  const b = { top: placement.top, left: placement.left, ...bubble };
  return (
    b.left < anchor.left + anchor.width &&
    b.left + b.width > anchor.left &&
    b.top < anchor.top + anchor.height &&
    b.top + b.height > anchor.top
  );
}

/** Is the placement fully inside the viewport? */
export function withinViewport(
  placement: Placement,
  bubble: Size,
  viewport: Viewport
): boolean {
  if (placement.mode === "docked") return true;
  return (
    placement.left >= 0 &&
    placement.top >= 0 &&
    placement.left + bubble.width <= viewport.width &&
    placement.top + bubble.height <= viewport.height
  );
}

/**
 * Positioning styles + classes for a bubble, given a placement.
 *
 * Lives here, not in use-anchor.ts, because it is pure and the self-test runs
 * on the server — a `"use client"` module's exports cannot be called there.
 *
 * `found === false` (the anchor is not on this page) docks rather than hiding.
 * Callers that should hide instead check `found` themselves; a tour step must
 * dock, because three of its six anchors are sidebar nav items that genuinely
 * do not exist in the DOM on a phone.
 */
export function bubbleStyle(placement: Placement | null, found: boolean | null) {
  const docked = !placement || placement.mode === "docked" || found === false;
  return {
    docked,
    style:
      placement && placement.mode === "floating"
        ? { top: `${placement.top}px`, left: `${placement.left}px` }
        : undefined,
  };
}
