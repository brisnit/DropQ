"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";
import type { AuthState } from "@/lib/actions/auth";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "One sec…" : label}
    </Button>
  );
}

export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "signup";
  action: (prev: AuthState, fd: FormData) => Promise<AuthState>;
}) {
  const [state, formAction] = useActionState(action, {});
  const isSignup = mode === "signup";

  return (
    <form action={formAction} className="space-y-4">
      {isSignup && (
        <Field label="Store name" hint="You can change this anytime.">
          <Input name="storeName" placeholder="Marble & Crumb" required autoFocus />
        </Field>
      )}
      <Field label="Email">
        <Input
          name="email"
          type="email"
          placeholder="you@email.com"
          required
          autoFocus={!isSignup}
          autoComplete="email"
        />
      </Field>
      <Field label="Password" hint={isSignup ? "At least 8 characters." : undefined}>
        <PasswordInput
          name="password"
          placeholder="••••••••"
          required
          autoComplete={isSignup ? "new-password" : "current-password"}
        />
      </Field>

      {!isSignup && (
        <div className="-mt-2 text-right">
          <Link href="/forgot" className="text-sm text-brand font-medium hover:underline">
            Forgot password?
          </Link>
        </div>
      )}

      {isSignup && (
        <label className="flex items-start gap-2.5 text-sm text-ink-soft">
          <input type="checkbox" name="acceptTerms" required className="mt-0.5 w-4 h-4 accent-[#6d28d9] shrink-0" />
          <span>
            I have read and agree to the{" "}
            <Link href="/terms" target="_blank" className="text-brand font-medium hover:underline">
              DropQ Vendor Agreement &amp; Terms
            </Link>
            .
          </span>
        </label>
      )}

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}

      <SubmitButton label={isSignup ? "Create my store" : "Log in"} />

      <p className="text-base text-muted text-center pt-1">
        {isSignup ? (
          <>
            Already selling?{" "}
            <Link href="/login" className="text-brand font-medium hover:underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to DropQ?{" "}
            <Link href="/signup" className="text-brand font-semibold hover:underline">
              Start your store
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
