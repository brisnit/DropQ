"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui";
import { resetPasswordAction, type ResetState } from "@/lib/actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Set new password"}
    </Button>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ResetState, FormData>(
    resetPasswordAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label="New password" hint="At least 8 characters.">
        <Input
          name="password"
          type="password"
          placeholder="••••••••"
          required
          autoFocus
          autoComplete="new-password"
        />
      </Field>
      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}
      <SubmitButton />
      <p className="text-sm text-muted text-center pt-1">
        <Link href="/login" className="text-brand font-medium hover:underline">
          Back to log in
        </Link>
      </p>
    </form>
  );
}
