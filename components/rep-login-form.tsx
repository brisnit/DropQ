"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { repLoginAction, type RepAuthState } from "@/lib/actions/rep-auth";
import { Input } from "@/components/ui";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full bg-ink text-white font-semibold rounded-pill py-3 hover:bg-ink-soft transition disabled:opacity-50"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function RepLoginForm() {
  const [state, action] = useActionState<RepAuthState, FormData>(repLoginAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <p className="text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">{state.error}</p>
      )}
      <div>
        <label className="block text-sm font-medium mb-1">Email</label>
        <Input name="email" type="email" required autoFocus />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Password</label>
        <Input name="password" type="password" required />
      </div>
      <SubmitBtn />
    </form>
  );
}
