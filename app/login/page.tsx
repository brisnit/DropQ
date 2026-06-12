import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { loginAction } from "@/lib/actions/auth";
import { getCurrentSeller } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = { title: "Log in — DropQ" };

export default async function LoginPage() {
  if (await getCurrentSeller()) redirect("/dashboard");
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to manage your drops, orders, and customers."
    >
      <AuthForm mode="login" action={loginAction} />
    </AuthShell>
  );
}
