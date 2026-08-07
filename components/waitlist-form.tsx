"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { vendorPalette, darkenColor } from "@/lib/color";
import { subscribeAction, type SubscribeState } from "@/lib/actions/subscribe";

function SubmitButton({ cta }: { cta: string }) {
  const { pending } = useFormStatus();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="submit"
      disabled={pending}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ backgroundColor: pending ? cta : hover ? darkenColor(cta, 0.08) : cta }}
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
  const cta = vendorPalette(accent).vendor_cta_color;

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
      <input name="phone" type="tel" placeholder="Mobile number (optional)" className={inputCls} />

      <label className="flex items-start gap-2.5 text-sm text-ink-soft">
        <input
          type="checkbox"
          name="optInEmail"
          defaultChecked
          className="mt-0.5 w-4 h-4 accent-[#ff6268]"
        />
        <span>Email me when {storeName} has a new drop.</span>
      </label>

      {/*
        SMS consent must stay unchecked, unbundled from email, and carry the
        full disclosure set (sender, recurring, not-a-condition-of-purchase,
        frequency, rates, STOP/HELP, terms + privacy links). This exact block
        is what carriers review during A2P 10DLC campaign registration — don't
        pre-check it or trim the copy.
      */}
      <label className="flex items-start gap-2.5 text-sm text-ink-soft">
        <input type="checkbox" name="optInSms" className="mt-0.5 w-4 h-4 accent-[#ff6268]" />
        <span>
          <span className="font-medium text-ink">Text me when {storeName} has a new drop.</span>{" "}
          <span className="text-muted text-xs leading-snug block mt-1">
            By checking this box you agree to receive recurring marketing text messages from
            DropQ on behalf of {storeName} at the number provided, including messages sent by
            autodialer. Consent is not a condition of purchase. Msg frequency varies (typically
            2–6/month). Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">
              Terms
            </a>{" "}
            ·{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
              Privacy Policy
            </a>
          </span>
        </span>
      </label>

      {geofence && (
        <label className="flex items-start gap-2.5 text-sm text-ink-soft">
          <input type="checkbox" name="optInGeofence" className="mt-0.5 w-4 h-4 accent-[#ff6268]" />
          <span>Also alert me when I&apos;m near {storeName} during a live drop.</span>
        </label>
      )}

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}
      <SubmitButton cta={cta} />
    </form>
  );
}
