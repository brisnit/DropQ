"use client";

import { useState } from "react";
import { markSharedAction } from "@/lib/actions/guidance";
import { trackGuidance } from "@/lib/analytics";

/**
 * Robust share/copy: native share sheet on mobile when available, otherwise
 * clipboard, with a hidden-textarea fallback for older/blocked contexts.
 */
export function ShareButton({
  url,
  title = "DropQ",
  className = "",
  label = "Share / Copy link",
  signalDropShare = false,
}: {
  url: string;
  title?: string;
  className?: string;
  label?: string;
  /**
   * True only where this button shares a DROP with customers — it completes the
   * "Share your drop" activation milestone. Deliberately opt-in: the walk-up
   * screen uses the same button to hand one standing customer a payment link,
   * which is a sale, not putting a drop in front of an audience.
   *
   * A boolean rather than a callback because every call site is a Server
   * Component and cannot pass a function across the boundary.
   */
  signalDropShare?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "shared">("idle");

  function flash(next: "copied" | "shared") {
    setState(next);
    setTimeout(() => setState("idle"), 1900);
  }

  /**
   * Fire-and-forget. Sharing must never wait on, or fail because of, guidance
   * bookkeeping — the vendor's link is already on their clipboard by the time
   * this runs, and a rejected promise here would be an unhandled rejection for
   * nothing.
   */
  function signalShared(method: "copy" | "share_sheet") {
    if (!signalDropShare) return;
    trackGuidance("drop_shared", { method });
    void markSharedAction().catch(() => {});
  }

  async function copyFallback() {
    try {
      await navigator.clipboard.writeText(url);
      flash("copied");
      signalShared("copy");
      return;
    } catch {
      /* try execCommand */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      flash("copied");
      signalShared("copy");
    } catch {
      // Last resort: show the URL so the user can copy manually.
      window.prompt("Copy this link:", url);
    }
  }

  async function onClick() {
    const canShare =
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if (canShare) {
      try {
        await navigator.share({ title, url });
        flash("shared");
        signalShared("share_sheet");
        return;
      } catch {
        // user canceled or share failed — fall through to copy
      }
    }
    await copyFallback();
  }

  const text =
    state === "copied" ? "✓ Link copied" : state === "shared" ? "✓ Shared" : label;

  return (
    <button type="button" onClick={onClick} className={className}>
      {text}
    </button>
  );
}
