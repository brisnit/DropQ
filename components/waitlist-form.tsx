"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { subscribeAction, type SubscribeState } from "@/lib/actions/subscribe";

function SubmitButton({ accent }: { accent: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ backgroundColor: accent }}
      className="w-full text-white font-semibold rounded-xl py-3 disabled:opacity-50 transition active:scale-[0.99]"
    >
      {pending ? "Signing up…" : "Notify me about future drops"}
    </button>
  );
}

export function WaitlistForm({
  sellerId,
  dropId,
  storeName,
  accent,
  geofence = false,
}: {
  sellerId: string;
  dropId?: string;
  storeName: string;
  accent: string;
  geofence?: boolean;
}) {
  const [state, formAction] = useActionState<SubscribeState, FormData>(subscribeAction, {});

  if (state.ok) {
    return (
      <div className="bg-paper border border-line rounded-card p-6 text-center">
        <div className="text-3xl">🎉</div>
        <h3 className="font-display text-xl font-semibold mt-2">You&apos;re on the list!</h3>
        <p className="text-muted mt-1 text-sm">
          We&apos;ll let you know the moment {storeName} drops something new.
        </p>
      </div>
    );
  }

  const inputCls =
    "w-full bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-ink/40";

  return (
    <form action={formAction} className="bg-paper border border-line rounded-card p-6 space-y-3">
      <input type="hidden" name="sellerId" value={sellerId} />
      {dropId && <input type="hidden" name="dropId" value={dropId} />}
      <div>
        <h3 className="font-display text-lg font-semibold">Never miss a drop</h3>
        <p className="text-sm text-muted">Sign up and {storeName} will notify you about future drops.</p>
      </div>
      <input name="name" placeholder="Your name" className={inputCls} />
      <input name="email" type="email" placeholder="Email" className={inputCls} />
      <input name="phone" type="tel" placeholder="Phone (for text alerts)" className={inputCls} />

      <label className="flex items-start gap-2.5 text-sm text-ink-soft">
        <input type="checkbox" name="optIn" defaultChecked className="mt-0.5 w-4 h-4 accent-[#6d28d9]" />
        <span>Yes, notify me about future drops by email{" "}{/* */}and/or text. I can opt out anytime.</span>
      </label>
      {geofence && (
        <label className="flex items-start gap-2.5 text-sm text-ink-soft">
          <input type="checkbox" name="optInGeofence" className="mt-0.5 w-4 h-4 accent-[#6d28d9]" />
          <span>Also alert me when I&apos;m near {storeName} during a live drop.</span>
        </label>
      )}

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}
      <SubmitButton accent={accent} />
    </form>
  );
}
