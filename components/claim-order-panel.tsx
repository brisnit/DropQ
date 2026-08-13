"use client";

import { useActionState } from "react";
import { requestMagicLinkAction, type MagicLinkState } from "@/lib/actions/customer-auth";
import { Avatar } from "@/components/avatar";

/**
 * Post-checkout conversion.
 *
 * There is nothing to "claim" mechanically — checkout already created the
 * Customer and stamped `Order.customerId`, so the order is attached before this
 * ever renders. All that's missing is proof the person holds the email. So this
 * is a one-tap magic link, not a second signup form: nothing is retyped, and no
 * password exists to invent.
 *
 * The follow checkbox is an explicit, visible opt-in that rides on the token.
 * It grants in-app "tell me when they drop" only — never marketing consent,
 * which is tracked separately per channel.
 */
export function ClaimOrderPanel({
  email,
  vendorId,
  vendorName,
  vendorLogo,
  returnTo,
}: {
  email: string;
  vendorId: string;
  vendorName: string;
  vendorLogo: string | null;
  returnTo: string;
}) {
  const [state, formAction, pending] = useActionState<MagicLinkState, FormData>(
    requestMagicLinkAction,
    {}
  );

  if (state.sent) {
    return (
      <div className="bg-paper border border-line rounded-card p-5 text-center">
        <div className="text-3xl">📬</div>
        <h2 className="font-display text-lg font-semibold mt-2">Check your email</h2>
        <p className="text-sm text-muted mt-1">
          We sent a sign-in link to <b className="text-ink">{email}</b>. Open it and your order
          will be waiting in My DropQ.
        </p>
        {state.devLink && (
          <a href={state.devLink} className="mt-3 inline-block text-xs text-brand break-all underline">
            Dev link (no email provider configured)
          </a>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="bg-paper border border-line rounded-card p-5">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={returnTo} />
      <input type="hidden" name="followSellerId" value={vendorId} />

      <div className="flex items-start gap-3">
        <Avatar name={vendorName} imageUrl={vendorLogo} seed={vendorId} />
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold leading-tight">
            Save your order and follow {vendorName}
          </h2>
          <p className="text-sm text-muted mt-1">
            Create a free DropQ account to track this order, get pickup updates, and hear about
            future drops from {vendorName}.
          </p>
        </div>
      </div>

      <label className="flex items-start gap-2.5 mt-4 text-sm text-ink-soft cursor-pointer">
        <input
          type="checkbox"
          name="follow"
          defaultChecked
          className="mt-0.5 w-4 h-4 accent-[#ff6268]"
        />
        <span>
          Follow {vendorName} so their next drop shows up in My DropQ. You can unfollow any time —
          this doesn&apos;t sign you up for marketing emails or texts.
        </span>
      </label>

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2 mt-3">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full mt-4 min-h-[48px] rounded-pill bg-ink text-cream font-semibold text-sm transition active:scale-[0.99] disabled:opacity-50"
      >
        {pending ? "Sending…" : "Save my order"}
      </button>
      <p className="text-xs text-muted text-center mt-2">
        We&apos;ll email {email} a one-tap sign-in link. No password needed.
      </p>
    </form>
  );
}
