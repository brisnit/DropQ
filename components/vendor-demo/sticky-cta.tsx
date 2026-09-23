"use client";

import { useEffect, useRef, useState } from "react";
import { LinkButton } from "@/components/ui";

/**
 * The sign-up bar that follows the page down on phones.
 *
 * ── WHY IT HIDES ITSELF ───────────────────────────────────────────────────
 *
 * It sat directly on top of the walkthrough's own advance button — two
 * full-width black buttons in the same thumb position, and the one that mattered
 * was underneath. Someone tapping through the demo at a market stall would have
 * hit "Start selling" while trying to reach "Next".
 *
 * So while the walkthrough is on screen the bar gets out of the way. The demo
 * already ends on a sign-up CTA, and the page has two more; nobody loses a way
 * in, and the person keeps the one control they are actually using.
 */
export function VendorDemoStickyCta({ watch }: { watch: string }) {
  const [hidden, setHidden] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    const target = document.getElementById(watch);
    if (!target) return;

    // A generous threshold: the bar should be gone before a thumb gets near
    // the demo's controls, not at the instant they collide.
    const io = new IntersectionObserver(
      ([entry]) => {
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => setHidden(entry.isIntersecting));
      },
      { rootMargin: "-25% 0px -25% 0px" }
    );
    io.observe(target);
    return () => { io.disconnect(); cancelAnimationFrame(raf.current); };
  }, [watch]);

  return (
    <div
      // `inert` as well as hidden: a bar that has slid off screen must not stay
      // in the tab order, or a keyboard user lands on an invisible button.
      inert={hidden || undefined}
      aria-hidden={hidden || undefined}
      className={`sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line bg-paper/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-300 ${
        hidden ? "translate-y-full" : "translate-y-0"
      }`}
    >
      <LinkButton href="/signup" size="lg" className="w-full justify-center">
        Start selling on DropQ
      </LinkButton>
    </div>
  );
}
