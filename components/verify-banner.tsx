"use client";

import { useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { resendVerificationAction } from "@/lib/actions/auth";

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="underline underline-offset-2 font-medium hover:opacity-80 disabled:opacity-50"
    >
      {pending ? "Sending…" : "Resend email"}
    </button>
  );
}

export function VerifyBanner({ verified }: { verified: boolean }) {
  const sp = useSearchParams();

  if (verified) {
    if (sp.get("verified") === "1") {
      return (
        <div className="bg-sage-tint text-sage text-sm px-5 py-2.5 text-center">
          ✓ Email verified — you&apos;re all set.
        </div>
      );
    }
    return null;
  }

  const sent = sp.get("verifysent") === "1";
  return (
    <div className="bg-brand-tint text-brand-dark text-sm px-5 py-2.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
      <span>📧 Verify your email to secure your account.</span>
      {sent ? (
        <span className="font-medium">Sent — check your inbox.</span>
      ) : (
        <form action={resendVerificationAction} className="inline">
          <ResendButton />
        </form>
      )}
    </div>
  );
}
