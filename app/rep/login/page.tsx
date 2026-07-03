import { redirect } from "next/navigation";
import { getCurrentRep } from "@/lib/rep-auth";
import { Logo } from "@/components/logo";
import { RepLoginForm } from "@/components/rep-login-form";

export const metadata = { title: "Sales Rep Login — DropQ" };

export default async function RepLoginPage() {
  // Already signed in → go to the portal.
  if (await getCurrentRep()) redirect("/rep");

  return (
    <div className="min-h-screen grid place-items-center px-5">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <div className="bg-paper border border-line rounded-card p-6 sm:p-8 shadow-[var(--shadow-soft)]">
          <h1 className="font-display text-2xl font-semibold text-center">Sales Rep Portal</h1>
          <p className="text-sm text-muted text-center mt-1 mb-6">
            Track your referred vendors and commission.
          </p>
          <RepLoginForm />
        </div>
        <p className="text-xs text-muted text-center mt-4">
          Not a sales rep? <a href="/login" className="text-brand hover:underline">Vendor login →</a>
        </p>
      </div>
    </div>
  );
}
