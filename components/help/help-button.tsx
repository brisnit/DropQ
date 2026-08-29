"use client";

import { useEffect, useState } from "react";
import { HelpPanel } from "@/components/help/panel";
import type { GuidanceCapabilities } from "@/lib/guidance";

/**
 * Help is one panel with many doors.
 *
 * `HelpHost` mounts the panel and owns its state; it is rendered ONCE in the
 * dashboard layout. `HelpTrigger` is a dumb button that asks the host to open
 * and can appear anywhere — the desktop header, the mobile header, the mobile
 * menu, an empty state.
 *
 * Keeping these separate is not tidiness. Both dashboard headers are always in
 * the DOM (one is `hidden md:flex`), so a component that both triggered and
 * rendered the panel would mount twice and open two overlapping dialogs on a
 * phone.
 */
export const OPEN_HELP_EVENT = "dropq:open-help";

/** Ask the mounted panel to open, from anywhere on the page. */
export function openHelp() {
  window.dispatchEvent(new CustomEvent(OPEN_HELP_EVENT));
}

export function HelpHost({
  capabilities,
  tourLabel,
}: {
  capabilities: GuidanceCapabilities;
  tourLabel: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_HELP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_HELP_EVENT, onOpen);
  }, []);

  if (!open) return null;
  return (
    <HelpPanel
      capabilities={capabilities}
      tourLabel={tourLabel}
      onClose={() => setOpen(false)}
    />
  );
}

export function HelpTrigger({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openHelp}
      aria-label="Help"
      aria-haspopup="dialog"
      className={
        className ||
        "inline-flex items-center gap-1.5 h-11 px-3 rounded-xl text-sm font-medium text-ink-soft hover:bg-line/60 hover:text-ink transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      }
    >
      <span
        aria-hidden
        className="grid place-items-center w-5 h-5 rounded-full border border-current text-[11px] font-bold"
      >
        ?
      </span>
      <span className="hidden sm:inline">Help</span>
    </button>
  );
}
