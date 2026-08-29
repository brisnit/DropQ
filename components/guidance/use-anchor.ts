"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { anchorSelector, type AnchorId } from "@/lib/guidance";
import { computePlacement, type Placement } from "@/components/guidance/position";

/**
 * Track where a guidance bubble should sit relative to the element it points at.
 *
 * Extracted in G.2 so the coachmark and the tour step — which are the same
 * visual object with different chrome — cannot drift apart in how they find,
 * measure, highlight or follow their anchor. The geometry itself stays in the
 * pure `computePlacement`; this hook is only the DOM half.
 *
 * `found === false` means the anchor is not on this page. Callers decide what
 * that means: a coachmark renders nothing (it was describing something absent),
 * while a tour step docks and keeps its copy, because dropping three of six
 * steps on mobile — where the sidebar nav is inside a closed menu — would
 * strand the vendor mid-tour.
 */
export function useAnchorPlacement(
  anchor: AnchorId,
  bubbleRef: RefObject<HTMLElement | null>,
  { spotlight = true }: { spotlight?: boolean } = {}
) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  // `null` = not measured yet. Distinguishing that from `false` stops the
  // bubble flashing in the wrong place before the first measurement.
  const [found, setFound] = useState<boolean | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  /** One scroll correction per anchor; reset when the anchor changes. */
  const corrected = useRef(false);
  useEffect(() => {
    corrected.current = false;
  }, [anchor]);

  const reposition = useCallback(() => {
    const el = document.querySelector<HTMLElement>(anchorSelector(anchor));
    elRef.current = el;
    if (!el) {
      setFound(false);
      setPlacement(null);
      return;
    }
    setFound(true);
    const a = el.getBoundingClientRect();
    const b = bubbleRef.current?.getBoundingClientRect();
    setPlacement(
      computePlacement(
        { top: a.top, left: a.left, width: a.width, height: a.height },
        // Before first paint there is nothing to measure, so assume the width
        // the stylesheet gives it and a two-line height; the layout effect
        // corrects it on the next frame from the real box.
        { width: b?.width || 320, height: b?.height || 150 },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [anchor, bubbleRef]);

  // Layout effect so the first paint is already correct — a bubble that appears
  // in one place and jumps to another reads as a bug.
  useLayoutEffect(() => {
    reposition();
  }, [reposition]);

  /**
   * Bring the anchor on screen before explaining it.
   *
   * Coachmarks fire on page load, and the thing being taught is often below
   * the fold — the order-window section sits ~880px down a 900px-tall desktop
   * viewport. Without this the vendor reads about a control they cannot see,
   * which is worse than saying nothing.
   *
   * `block: "center"` rather than "start" so the anchor lands where there is
   * room for a bubble above or below it. Instant under reduced-motion: an
   * unrequested smooth scroll is exactly the kind of movement that setting
   * exists to prevent.
   */
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // "Visible" needs room, not merely a pixel on screen. An anchor flush
    // against the bottom edge is technically in view and practically useless:
    // everything it labels is below the fold, and the bubble is squeezed above
    // it. COMFORT is roughly one bubble's height.
    const COMFORT = 160;
    const visible =
      r.top >= COMFORT && r.bottom <= window.innerHeight - COMFORT;
    if (visible) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [found]);

  /**
   * A docked bubble must not sit on top of its own anchor.
   *
   * Centring the anchor is enough when the bubble floats beside it, but a
   * docked sheet is tall — on a phone it can be half the screen — so an anchor
   * centred vertically still ends up underneath it. That is the one failure
   * this whole positioning module exists to prevent, so it gets its own pass:
   * measure the real overlap after render and scroll it away.
   *
   * Runs at most once per anchor. Scrolling triggers `reposition`, which would
   * otherwise re-trigger this and chase the anchor up the page.
   */
  useEffect(() => {
    if (!placement || placement.mode !== "docked" || corrected.current) return;
    const el = elRef.current;
    const bubble = bubbleRef.current;
    if (!el || !bubble) return;
    const a = el.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const GAP = 16;
    const overlap = a.bottom - (b.top - GAP);
    if (overlap <= 0) return;
    corrected.current = true;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({ top: overlap, behavior: reduced ? "auto" : "smooth" });
  }, [placement, bubbleRef]);

  /**
   * Re-measure once the bubble's real size is known.
   *
   * The first placement runs before the bubble has ever been laid out, so it
   * uses an assumed height. A two-line estimate against a four-line bubble put
   * the box 58px lower than intended — enough to overlap the very control it
   * was pointing at. A ResizeObserver corrects it on the next frame and keeps
   * up if the copy reflows.
   */
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => reposition());
    ro.observe(el);
    return () => ro.disconnect();
  }, [reposition, bubbleRef]);

  useEffect(() => {
    const onChange = () => reposition();
    window.addEventListener("resize", onChange);
    // Capture phase: a scrollable panel between the anchor and the window still
    // moves the anchor, and those events don't bubble.
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [reposition]);

  // Ring the anchor while the bubble is up, and always take it off again —
  // including when the component unmounts mid-scroll or the step advances.
  useEffect(() => {
    if (!spotlight) return;
    const el = document.querySelector<HTMLElement>(anchorSelector(anchor));
    el?.classList.add("guidance-spotlight");
    return () => el?.classList.remove("guidance-spotlight");
  }, [anchor, spotlight]);

  return { placement, found, reposition };
}
