"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_LINKS } from "@/lib/site-links";

/**
 * The public site's menu on a phone.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────
 *
 * SiteNav renders its links as `hidden md:flex`, so below 768px the marketing
 * header offered a logo and two buttons and nothing else. DropMeet, Find
 * Drops, How It Works, Features and Pricing were all unreachable from a phone
 * — not cramped, not collapsed, simply absent. Most people who scan a DropQ QR
 * code at a market arrive on exactly that header.
 *
 * ── WHY A DROPDOWN AND NOT A FULL-SCREEN SHEET ────────────────────────────
 *
 * Because the dashboard already uses a dropdown panel for the same job, and a
 * marketing site that opens a different kind of menu than the product teaches
 * people two things where one would do. Same panel shape, same item styling,
 * same backdrop behaviour as components/mobile-nav.tsx.
 *
 * It does add two things that one lacks, and which matter more here because a
 * stranger is the one holding the phone: Escape closes it and returns focus to
 * the button, and a route change closes it so the menu never survives into the
 * page it just opened.
 */
export function SiteNavMobile() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape closes and hands focus back. Without the second half, a keyboard
  // user closes the menu and lands nowhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Close when the route changes. Tapping a link already calls close(), but a
  // back gesture or an in-page anchor does not, and a menu left hanging over
  // the page it navigated to looks broken.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Move focus into the panel so the first link is the next thing reached,
  // rather than whatever happens to follow the button in the DOM.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [open]);

  /**
   * Close on a tap anywhere else.
   *
   * A full-screen `position: fixed` backdrop — which is how the dashboard menu
   * does this — DOES NOT WORK HERE. The site header carries `backdrop-blur-md`,
   * and an element with a backdrop-filter becomes the containing block for its
   * fixed-position descendants. The backdrop was therefore confined to the
   * 64px-tall header instead of covering the viewport, so a tap on the page
   * below it hit nothing and the menu stayed open.
   *
   * A document-level listener does not care about stacking contexts.
   * `pointerdown` rather than `click` so the menu is already gone by the time
   * a tap lands on whatever is underneath.
   */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="relative md:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center justify-center w-11 h-11 -ml-1 rounded-lg text-ink-soft hover:bg-line/60 active:bg-line transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tertiary/60"
      >
        {open ? (
          <span className="text-xl leading-none" aria-hidden>✕</span>
        ) : (
          <svg
            width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        )}
      </button>

      {open && (
        <div
            id={panelId}
            ref={panelRef}
            className="absolute left-0 top-full mt-2 z-50 w-[min(19rem,calc(100vw-2rem))] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain bg-paper border border-line rounded-2xl shadow-[var(--shadow-lift)] p-2"
          >
            {SITE_LINKS.map((l, i) => {
              const active =
                !l.href.startsWith("/#") &&
                (pathname === l.href || pathname.startsWith(l.href + "/"));
              return (
                <div key={l.href}>
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`block px-3 py-2.5 rounded-xl transition ${
                      active ? "bg-ink text-cream" : "text-ink hover:bg-line/70"
                    }`}
                  >
                    <span className="block text-sm font-medium">{l.label}</span>
                    <span className={`block text-xs mt-0.5 ${active ? "text-cream/70" : "text-muted"}`}>
                      {l.hint}
                    </span>
                  </Link>
                  {i < SITE_LINKS.length - 1 && (
                    <div className="my-1 border-t border-line/70" aria-hidden />
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
