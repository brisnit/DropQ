import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import type { AnchorId } from "@/lib/guidance";

/**
 * Marks an element as something guidance can point at.
 *
 *   <GuidanceAnchor id="drop.publish">
 *     <Button type="submit">Publish drop</Button>
 *   </GuidanceAnchor>
 *
 * It renders NOTHING of its own — it clones its single child and adds
 * `data-guidance-anchor`. That matters more than it looks:
 *
 *  - A wrapper <div> would change layout wherever it landed (flex children,
 *    grid tracks, `space-y` siblings), so anchoring an element could silently
 *    move it.
 *  - `display: contents` on a wrapper avoids the layout change but makes the
 *    element unmeasurable — `getBoundingClientRect()` returns all zeros, and
 *    every coachmark would render in the top-left corner.
 *
 * Cloning sidesteps both. It works on DOM elements and on our own components
 * (Button, LinkButton and friends already spread `...props` onto the element).
 *
 * The `id` is typed against the ANCHORS registry in lib/guidance.ts, so an
 * anchor that a coachmark or tour step references can't be renamed or deleted
 * without a compile error. The same attribute is what the Phase 5 screenshot
 * runner targets to draw highlight overlays, which is why the tour, coachmarks
 * and documentation images can never point at different things.
 *
 * ⚠️ Server-component safe — no "use client". Anchoring an element must never
 * be the reason a server-rendered page acquires a client boundary.
 *
 * ⚠️ NOT CURRENTLY MOUNTED. Every anchored element in Phases 2–3 turned out to
 * accept the attribute directly — nav links, buttons, section labels, the QR
 * card — so the call sites write `data-guidance-anchor="..."` themselves and
 * this wrapper was never needed. It is kept for the case it was built for: an
 * element that cannot take the attribute (a third-party component, or one
 * whose props are not spread). Nothing imports it, so it costs no bundle.
 */
export function GuidanceAnchor({
  id,
  children,
}: {
  id: AnchorId;
  children: ReactNode;
}) {
  // Exactly one element, or we pass through untouched. Throwing here (which is
  // what Children.only does) would take down a whole dashboard page over a
  // guidance hint, which is never the right trade.
  const single = Children.count(children) === 1 ? children : null;

  if (!single || !isValidElement(single)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[guidance] <GuidanceAnchor id="${id}"> needs exactly one element child; rendering children unchanged.`
      );
    }
    return <>{children}</>;
  }

  return cloneElement(single as ReactElement<Record<string, unknown>>, {
    "data-guidance-anchor": id,
  });
}
