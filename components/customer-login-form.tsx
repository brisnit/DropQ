"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestMagicLinkAction, type MagicLinkState } from "@/lib/actions/customer-auth";
import { googleSignInAction } from "@/lib/actions/oauth";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full min-h-[48px] rounded-xl bg-ink text-cream font-semibold text-sm transition active:scale-[0.99] disabled:opacity-50"
    >
      {pending ? "Sending…" : "Email me a sign-in link"}
    </button>
  );
}

/**
 * Passwordless sign-in for buyers. Deliberately says nothing about whether an
 * address exists — the same confirmation shows either way.
 */
export function CustomerLoginForm({
  next,
  expired,
  vendorName = null,
  oauthError = null,
}: {
  next: string;
  expired?: boolean;
  oauthError?: string | null;
  /** When set, the copy leads with the vendor who sent them here. */
  vendorName?: string | null;
}) {
  const [state, formAction] = useActionState<MagicLinkState, FormData>(requestMagicLinkAction, {});

  if (state.sent) {
    return (
      <div className="bg-paper border border-line rounded-card p-6 text-center">
        <div className="text-3xl">📬</div>
        <h2 className="font-display text-xl font-semibold mt-2">Check your email</h2>
        <p className="text-muted mt-2 text-sm">
          If you&apos;ve ordered through DropQ with that address, a sign-in link is on its way. It
          works once and expires in 30 minutes.
        </p>
        {state.devLink && (
          <a
            href={state.devLink}
            className="mt-4 inline-block text-sm text-brand underline break-all"
          >
            Dev mode — open sign-in link
          </a>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="bg-paper border border-line rounded-card p-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <h1 className="font-display text-xl font-semibold">
          {vendorName ? `Create your DropQ account to order from ${vendorName}` : "Sign in to DropQ"}
        </h1>
        <p className="text-sm text-muted mt-1">
          {vendorName
            ? `Enter your email and we'll send a one-tap sign-in link. Your account tracks this order and any future drops from ${vendorName}.`
            : "Enter the email you used to order and we'll send you a sign-in link — no password needed."}
        </p>
      </div>

      {GOOGLE_ENABLED && (
        <>
          <button
            formAction={googleSignInAction}
            className="w-full min-h-[48px] rounded-xl border border-line-strong bg-paper font-semibold text-sm inline-flex items-center justify-center gap-2.5 hover:border-ink/30 transition"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
            </svg>
            Continue with Google
          </button>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="flex-1 border-t border-line" />
            or
            <span className="flex-1 border-t border-line" />
          </div>
        </>
      )}

      {oauthError && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{oauthError}</p>
      )}

      {expired && !state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">
          That link has expired or was already used. Request a new one.
        </p>
      )}

      <input
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        aria-label="Email address"
        className="w-full min-h-[48px] bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition"
      />

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}

      <SubmitButton />
    </form>
  );
}
