"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";

/**
 * The modal shell every blocking piece of guidance sits in — the welcome
 * screen today, the tour's mobile sheet in Phase 2.
 *
 * Accessibility is decided ONCE, here, rather than re-argued in each component:
 *
 *  - `role="dialog"` + `aria-modal` + a real accessible name
 *  - focus moves in on open and returns to the trigger on close
 *  - Tab and Shift+Tab cycle inside; focus cannot escape to the page behind
 *  - Escape closes
 *  - the page behind cannot scroll while it is open
 *
 * ⚠️ Coachmarks deliberately do NOT use this. They are non-modal notes beside
 * an element; trapping focus in one would stop a vendor using the very control
 * being described. See coachmark.tsx.
 *
 * No portal. The existing Lightbox in storefront-order.tsx renders a plain
 * `fixed inset-0` element and works correctly; adding react-dom/client portals
 * here would be a second pattern for no benefit.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function GuidanceOverlay({
  onClose,
  title,
  children,
  dismissOnBackdrop = true,
  labelledBy,
  variant = "modal",
}: {
  onClose: () => void;
  /** Accessible name. Ignored when `labelledBy` names an element instead. */
  title?: string;
  children: ReactNode;
  dismissOnBackdrop?: boolean;
  labelledBy?: string;
  /**
   * `modal` — a centred card (welcome).
   * `drawer` — a full-height right-hand panel on desktop, bottom sheet on
   *   mobile (Help). Same focus trap, same Escape, same scroll lock; only the
   *   box differs, so there is one accessibility implementation, not two.
   */
  variant?: "modal" | "drawer";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const fallbackId = useId();

  const focusables = useCallback((): HTMLElement[] => {
    const root = panelRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
  }, []);

  // Remember what had focus, move focus in, restore on the way out.
  //
  // Focus lands on the PANEL, not the first focusable. The first focusable is
  // the ✕, so focusing it drew a ring around "close" as the very first thing a
  // new vendor saw — and pointing a keyboard user at the dismiss control before
  // they have read anything is backwards. The panel carries role="dialog" and
  // an accessible name, so screen readers announce the dialog properly, and
  // Tab moves into the content from there.
  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      // The trigger may have unmounted (a tour step's own Next button, say);
      // focusing a detached node throws nothing but achieves nothing either.
      const target = returnFocusTo.current;
      if (target && document.contains(target)) target.focus();
    };
  }, [focusables]);

  // Escape to close, Tab cycles within the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, focusables]);

  // Lock the page behind. Restores the previous value rather than assuming it
  // was empty — another overlay may already have locked it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[60] flex bg-ink/50 guidance-backdrop ${
        variant === "drawer"
          ? "items-end sm:items-stretch justify-center sm:justify-end"
          : "items-end sm:items-center justify-center"
      }`}
      onMouseDown={(e) => {
        // mousedown, not click: a click that STARTS inside the panel and ends
        // on the backdrop (a drag over a text selection) must not close it.
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? fallbackId : undefined)}
        aria-label={labelledBy || title ? undefined : "Guidance"}
        tabIndex={-1}
        className={
          variant === "drawer"
            ? "guidance-enter w-full sm:w-[26rem] sm:max-w-full bg-paper border border-line sm:border-y-0 sm:border-r-0 rounded-t-card sm:rounded-none shadow-[var(--shadow-lift)] max-h-[92dvh] sm:max-h-none sm:h-dvh overflow-y-auto overscroll-contain focus:outline-none"
            : "guidance-enter w-full sm:max-w-lg bg-paper border border-line rounded-t-card sm:rounded-card shadow-[var(--shadow-lift)] max-h-[92dvh] overflow-y-auto overscroll-contain focus:outline-none"
        }
      >
        {title && !labelledBy && (
          <h2 id={fallbackId} className="sr-only">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
