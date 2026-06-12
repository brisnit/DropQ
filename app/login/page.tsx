import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { loginAction } from "@/lib/actions/auth";
import { getCurrentSeller } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = { title: "Log in — DropQ" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; verify_error?: string }>;
}) {
  if (await getCurrentSeller()) redirect("/dashboard");
  const sp = await searchParams;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to manage your drops, orders, and customers."
    >
      {sp.reset && (
        <p className="mb-4 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">
          Password updated — log in with your new password.
        </p>
      )}
      {sp.verify_error && (
        <p className="mb-4 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
          That verification link is invalid or expired. Log in and resend it from your dashboard.
        </p>
      )}
      <AuthForm mode="login" action={loginAction} />
    </AuthShell>
  );
}
