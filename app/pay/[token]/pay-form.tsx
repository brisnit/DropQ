"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { formatMoney } from "@/lib/format";
import { payWalkUpSaleAction, type PayState } from "@/lib/actions/pay";

/**
 * The customer's pay form. Two required fields and a big button — this should
 * feel like tapping a card terminal, not filling in an ecommerce checkout.
 */
function PayButton({ total, cta }: { total: number; cta: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ backgroundColor: cta }}
      className="w-full text-white font-semibold rounded-xl py-4 text-lg disabled:opacity-60 transition active:scale-[0.99]"
    >
      {pending ? "Taking you to payment…" : `Pay ${formatMoney(total)}`}
    </button>
  );
}

export function PayForm({
  token,
  total,
  cta,
  defaultEmail,
  defaultName,
}: {
  token: string;
  total: number;
  cta: string;
  defaultEmail?: string | null;
  defaultName?: string | null;
}) {
  const [state, formAction] = useActionState<PayState, FormData>(payWalkUpSaleAction, {});

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />

      <div className="grid grid-cols-2 gap-3">
        <input
          name="firstName"
          defaultValue={defaultName ?? ""}
          required
          autoComplete="given-name"
          placeholder="First name"
          className="bg-cream/60 border border-line-strong rounded-xl px-3.5 py-3 focus:outline-none focus:border-ink/40"
        />
        <input
          name="email"
          type="email"
          inputMode="email"
          defaultValue={defaultEmail ?? ""}
          required
          autoComplete="email"
          placeholder="Email"
          className="bg-cream/60 border border-line-strong rounded-xl px-3.5 py-3 focus:outline-none focus:border-ink/40"
        />
      </div>

      {/* Optional and visibly so — nothing here blocks payment. */}
      <details className="text-sm">
        <summary className="text-muted cursor-pointer select-none py-1">
          Add a phone number (optional)
        </summary>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="Mobile number"
          className="mt-2 w-full bg-cream/60 border border-line-strong rounded-xl px-3.5 py-3 focus:outline-none focus:border-ink/40"
        />
      </details>

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}

      <PayButton total={total} cta={cta} />
      <p className="text-xs text-muted text-center">
        🔒 Secure payment through DropQ · powered by Stripe
      </p>
    </form>
  );
}
