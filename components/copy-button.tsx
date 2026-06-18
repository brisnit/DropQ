"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
      className="text-sm font-medium text-ink px-3 py-2 rounded-lg border border-line-strong bg-paper hover:border-ink/30 transition whitespace-nowrap"
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}
