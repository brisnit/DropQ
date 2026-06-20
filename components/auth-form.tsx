"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button, Field, Input, Select } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";
import { CATEGORIES } from "@/lib/category";
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
  referralCode,
  defaultPlan = "starter",
}: {
  mode: "login" | "signup";
  action: (prev: AuthState, fd: FormData) => Promise<AuthState>;
  referralCode?: string;
  defaultPlan?: "starter" | "growth";
}) {
  const [state, formAction] = useActionState(action, {});
  const isSignup = mode === "signup";
  const [plan, setPlan] = useState<"starter" | "growth">(defaultPlan);

  const PLAN_OPTIONS = [
    { v: "starter" as const, name: "Starter", price: "Free", desc: "3 drops to start" },
    { v: "growth" as const, name: "Growth", price: "$20/mo", desc: "Unlimited drops + analytics" },
  ];

  return (
    <form action={formAction} className="space-y-4">
      {isSignup && referralCode && <input type="hidden" name="ref" value={referralCode} />}
      {isSignup && (
        <Field label="Store name" hint="You can change this anytime.">
          <Input name="storeName" placeholder="Marble & Crumb" required autoFocus />
        </Field>
      )}
      {isSignup && (
        <div>
          <span className="block text-sm font-medium text-ink-soft mb-1.5">Choose your plan</span>
          <div className="grid grid-cols-2 gap-2">
            {PLAN_OPTIONS.map((opt) => (
              <label key={opt.v} className="cursor-pointer">
                <input
                  type="radio"
                  name="plan"
                  value={opt.v}
                  checked={plan === opt.v}
                  onChange={() => setPlan(opt.v)}
                  className="peer sr-only"
                />
                <div className="h-full rounded-xl border border-line-strong p-3 peer-checked:border-brand peer-checked:bg-brand-tint/40 transition">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{opt.name}</span>
                    <span className="text-xs font-semibold text-brand">{opt.price}</span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
          {plan === "growth" && (
            <p className="text-xs text-muted mt-1.5">
              You&apos;ll continue to secure checkout right after creating your account.
            </p>
          )}
        </div>
      )}
      {isSignup && (
        <Field label="What do you sell?" hint="We'll tailor your store and wording to fit.">
          <Select name="category" defaultValue="food">
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
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

      {isSignup && (
        <Field
          label="Invite code"
          hint="Have an Early Partner code? Enter it — otherwise leave blank to start free on Starter."
        >
          <Input name="inviteCode" placeholder="Optional" autoComplete="off" />
        </Field>
      )}

      {!isSignup && (
        <div className="-mt-2 text-right">
          <Link href="/forgot" className="text-sm text-brand font-medium hover:underline">
            Forgot password?
          </Link>
        </div>
      )}

      {isSignup && (
        <label className="flex items-start gap-2.5 text-sm text-ink-soft">
          <input type="checkbox" name="acceptTerms" required className="mt-0.5 w-4 h-4 accent-[#cd1718] shrink-0" />
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

      <SubmitButton
        label={
          isSignup
            ? plan === "growth"
              ? "Create store & continue to payment"
              : "Create my store"
            : "Log in"
        }
      />

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
