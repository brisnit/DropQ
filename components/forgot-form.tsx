"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui";
import { requestPasswordResetAction, type ResetState } from "@/lib/actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Sending…" : "Email me a reset link"}
    </Button>
  );
}

export function ForgotForm() {
  const [state, formAction] = useActionState<ResetState, FormData>(
    requestPasswordResetAction,
    {}
  );

  if (state.sent) {
    return (
      <div className="space-y-4">
        <p className="text-sm bg-sage-tint text-sage rounded-lg px-3 py-3">
          If an account exists for that email, we&apos;ve sent a link to reset your
          password. Check your inbox (and spam).
        </p>
        <Link href="/login" className="text-sm text-brand font-medium hover:underline">
          ← Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email">
        <Input name="email" type="email" placeholder="you@email.com" required autoFocus autoComplete="email" />
      </Field>
      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}
      <SubmitButton />
      <p className="text-sm text-muted text-center pt-1">
        Remembered it?{" "}
        <Link href="/login" className="text-brand font-medium hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
