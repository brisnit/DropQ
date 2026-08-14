"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateNotificationsAction, type AccountState } from "@/lib/actions/account";

/**
 * SMS consent capture in account settings.
 *
 * Mirrors the checkout disclosure word for word — same wording, same
 * unchecked-by-default rule, same Terms/Privacy links. `defaultChecked`
 * reflects consent actually on file and is never true by default.
 */
export function NotificationPrefs({
  smsTransactional,
  smsMarketing,
  optedOut,
  hasPhone,
}: {
  smsTransactional: boolean;
  smsMarketing: boolean;
  optedOut: boolean;
  hasPhone: boolean;
}) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    updateNotificationsAction,
    {}
  );

  const links = (
    <>
      <Link href="/terms" className="underline">Terms</Link>{" "}and{" "}
      <Link href="/privacy" className="underline">Privacy Policy</Link>.
    </>
  );

  return (
    <form action={action} className="bg-paper border border-line rounded-card p-5">
      <h2 className="font-display text-lg font-semibold">Text messages</h2>
      <p className="text-sm text-muted mt-1">
        Texting is optional. Email still works either way.{" "}
        <Link href="/sms" className="text-brand hover:underline">How DropQ SMS works</Link>
      </p>

      {optedOut && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2 mt-3">
          You replied STOP to a DropQ text, so texts are switched off. Reply START to any DropQ
          message to turn them back on.
        </p>
      )}
      {!hasPhone && !optedOut && (
        <p className="text-sm text-muted bg-cream rounded-lg px-3 py-2 mt-3">
          Add a mobile number in your profile above to enable texts.
        </p>
      )}

      <div className="mt-4 space-y-4">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            name="smsTransactional"
            defaultChecked={smsTransactional}
            disabled={optedOut || !hasPhone}
            className="mt-0.5 w-4 h-4 accent-[#ff6268] shrink-0 disabled:opacity-40"
          />
          <span className="text-xs text-ink-soft leading-snug">
            I agree to receive text messages from DropQ related to my account, orders, payments,
            pickups, and activity on the DropQ platform. Message frequency varies. Message and data
            rates may apply. Reply STOP to opt out or HELP for help. Consent is not required to
            create an account or make a purchase. See {links}
          </span>
        </label>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            name="smsMarketing"
            defaultChecked={smsMarketing}
            disabled={optedOut || !hasPhone}
            className="mt-0.5 w-4 h-4 accent-[#ff6268] shrink-0 disabled:opacity-40"
          />
          <span className="text-xs text-ink-soft leading-snug">
            I&apos;d also like to receive text alerts from DropQ about vendors, drops, and products
            I choose to follow. Message frequency varies. Message and data rates may apply. Reply
            STOP to opt out or HELP for help. See {links}
          </span>
        </label>
      </div>

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2 mt-3">{state.error}</p>
      )}
      {state.saved && (
        <p className="text-sm text-sage bg-sage-tint rounded-lg px-3 py-2 mt-3">Preferences saved.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save preferences"}
      </button>
    </form>
  );
}
