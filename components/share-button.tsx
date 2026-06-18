"use client";

import { useState } from "react";

/**
 * Robust share/copy: native share sheet on mobile when available, otherwise
 * clipboard, with a hidden-textarea fallback for older/blocked contexts.
 */
export function ShareButton({
  url,
  title = "DropQ",
  className = "",
  label = "Share / Copy link",
}: {
  url: string;
  title?: string;
  className?: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "shared">("idle");

  function flash(next: "copied" | "shared") {
    setState(next);
    setTimeout(() => setState("idle"), 1900);
  }

  async function copyFallback() {
    try {
      await navigator.clipboard.writeText(url);
      flash("copied");
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
