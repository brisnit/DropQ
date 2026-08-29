"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * "What is this?" — one short definition, attached to a term or a control.
 *
 * Tooltips answer a noun, never a workflow. If the copy needs a second
 * sentence it is a coachmark; if it needs a paragraph it is a help article.
 *
 * The three ways people actually reach a tooltip are all supported, because
 * supporting only hover excludes keyboard and touch users entirely:
 *
 *   hover   → mouse
 *   focus   → keyboard
 *   tap     → touch (hover never fires; a tap toggles it)
 *
 * The trigger is a real <button>, so it is focusable and announced, and it
 * carries `aria-describedby` pointing at the bubble — meaning a screen reader
 * reads the definition as part of the control rather than as stray text.
 * Escape closes. The bubble is `role="tooltip"`.
 *
 * ⚠️ NOT CURRENTLY MOUNTED. Built in G.1 for the vocabulary layer (drop,
 * preorder, order window, inventory…). G.3 shipped coachmarks instead, which
 * covered the concepts that were actually confusing vendors, and adding
 * tooltips on top would have been a second explanation of the same words.
 * Nothing imports it, so it costs no bundle; it is here for when a term needs
 * defining without a whole coachmark.
 */
export function Tooltip({
  label,
  children,
  side = "top",
}: {
  /** The definition. One sentence. */
  label: string;
  /** The term or control being defined. Text, or an icon with its own label. */
  children: ReactNode;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // A tap elsewhere closes it — without this, a touch user has no way to
    // dismiss a tooltip they opened by tapping.
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center gap-1 rounded-md underline decoration-dotted decoration-line-strong underline-offset-4 hover:decoration-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper cursor-help"
      >
        {children}
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={`guidance-enter absolute z-50 left-1/2 -translate-x-1/2 w-max max-w-[15rem] bg-ink text-cream text-xs leading-relaxed rounded-lg px-2.5 py-2 shadow-[var(--shadow-lift)] pointer-events-none ${
            side === "top" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
