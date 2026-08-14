"use client";

import { useActionState } from "react";
import { updateProfileAction, type AccountState } from "@/lib/actions/account";

/** Progressive profile — nothing is required. */
export function ProfileForm({ name, email, phone }: { name: string; email: string; phone: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(updateProfileAction, {});
  const input =
    "w-full bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition";

  return (
    <form action={action} className="bg-paper border border-line rounded-card p-5">
      <h2 className="font-display text-lg font-semibold">Profile</h2>
      <p className="text-sm text-muted mt-1">All optional — add what you find useful.</p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="block text-sm font-medium text-ink-soft mb-1.5">Name</span>
          <input name="name" defaultValue={name} placeholder="Your name" className={input} />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-ink-soft mb-1.5">Mobile number</span>
          <input name="phone" type="tel" defaultValue={phone} placeholder="+1 555 000 1234" className={input} />
          <span className="block text-xs text-muted mt-1.5">
            Storing a number doesn&apos;t opt you into texts — that&apos;s a separate choice below.
          </span>
        </label>

        <div>
          <span className="block text-sm font-medium text-ink-soft mb-1.5">Email</span>
          <p className="text-sm bg-cream border border-line rounded-xl px-3.5 py-2.5 text-muted">{email}</p>
          <span className="block text-xs text-muted mt-1.5">
            Your email identifies your account and every order on it. Email support@drop-q.com to change it.
          </span>
        </div>
      </div>

      {state.error && <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2 mt-3">{state.error}</p>}
      {state.saved && <p className="text-sm text-sage bg-sage-tint rounded-lg px-3 py-2 mt-3">Profile saved.</p>}

      <button type="submit" disabled={pending} className="mt-4 min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold disabled:opacity-50">
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
