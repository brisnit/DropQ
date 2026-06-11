import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { signupAction } from "@/lib/actions/auth";
import { getCurrentSeller } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = { title: "Start your store — DropQ" };

export default async function SignupPage() {
  if (await getCurrentSeller()) redirect("/dashboard");
  return (
    <AuthShell
      title="Start selling in minutes"
      subtitle="Create your store, build a drop, and share one link. No code, no monthly fee to start."
    >
      <AuthForm mode="signup" action={signupAction} />
    </AuthShell>
  );
}
