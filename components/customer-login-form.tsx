"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestMagicLinkAction, type MagicLinkState } from "@/lib/actions/customer-auth";

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
export function CustomerLoginForm({ next, expired }: { next: string; expired?: boolean }) {
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
        <h1 className="font-display text-xl font-semibold">Your messages</h1>
        <p className="text-sm text-muted mt-1">
          Enter the email you used to order and we&apos;ll send you a sign-in link — no password
          needed.
        </p>
      </div>

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
