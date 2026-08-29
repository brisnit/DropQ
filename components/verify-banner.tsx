"use client";

import { useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { resendVerificationAction } from "@/lib/actions/auth";

/**
 * The email-verification reminder.
 *
 * ⚠️ DELIBERATELY QUIET. Verifying your email gates nothing in DropQ — you can
 * log in, publish and take orders without it (see lib/activation.ts, where it
 * is not a milestone, and the Help article "Verifying your email").
 *
 * It used to render as a full-bleed brand-tinted strip and was, measurably, the
 * most prominent thing on a new vendor's dashboard: above their own store name
 * and above the activation card that tells them how to make their first sale.
 * A reminder for an optional task outranking the primary journey is a ranking
 * error, not a styling preference.
 *
 * So: a bordered notice in the page's own rhythm, muted text, a secondary
 * action. It stays on every dashboard page and keeps the same functionality —
 * it simply no longer shouts. Nothing here implies the vendor is blocked, and
 * the copy never mentions selling.
 */

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center min-h-11 whitespace-nowrap px-4 py-2 rounded-xl border border-line-strong bg-paper text-sm font-medium text-ink-soft hover:border-ink/30 hover:text-ink transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      {pending ? "Sending…" : "Send verification email"}
    </button>
  );
}

export function VerifyBanner({ verified }: { verified: boolean }) {
  const sp = useSearchParams();

  if (verified) {
    // Confirmation of something the vendor just did — announced, then gone.
    if (sp.get("verified") === "1") {
      return (
        <div className="px-5 sm:px-8 pt-5">
          <p
            role="status"
            className="rounded-xl bg-sage-tint text-sage text-sm px-4 py-2.5"
          >
            ✓ Email verified — you&apos;re all set.
          </p>
        </div>
      );
    }
    return null;
  }

  const sent = sp.get("verifysent") === "1";
  return (
    <div className="px-5 sm:px-8 pt-5">
      <div className="rounded-xl border border-line bg-paper px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Verify your email</p>
          <p className="text-sm text-muted mt-0.5 max-w-prose">
            Confirm your address so we can reach you about your account.
          </p>
        </div>
        {sent ? (
          <p role="status" className="text-sm font-medium text-sage shrink-0">
            Sent — check your inbox.
          </p>
        ) : (
          <form action={resendVerificationAction} className="shrink-0">
            <ResendButton />
          </form>
        )}
      </div>
    </div>
  );
}
