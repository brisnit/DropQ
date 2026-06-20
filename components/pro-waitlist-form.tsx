"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { joinProWaitlistAction, type WaitlistState } from "@/lib/actions/billing";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-lg bg-ink text-cream text-sm font-medium px-3.5 py-2 hover:bg-ink-soft transition disabled:opacity-50"
    >
      {pending ? "…" : "Notify me"}
    </button>
  );
}

export function ProWaitlistForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [state, action] = useActionState<WaitlistState, FormData>(
    joinProWaitlistAction,
    {}
  );

  if (state.joined) {
    return (
      <p className="text-sm text-sage font-medium mt-3">
        ✓ You&apos;re on the Pro waitlist — we&apos;ll email you when it opens.
      </p>
    );
  }

  return (
    <form action={action} className="mt-3">
      <div className="flex gap-2">
        <input
          name="email"
          type="email"
          required
          defaultValue={defaultEmail}
          placeholder="you@email.com"
          className="w-full bg-paper border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition"
        />
        <Submit />
      </div>
      {state.error && <p className="text-xs text-brand-dark mt-1.5">{state.error}</p>}
      <p className="text-xs text-muted mt-1.5">Join the waitlist for early access.</p>
    </form>
  );
}
