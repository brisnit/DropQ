import { AuthShell } from "@/components/auth-shell";
import { ForgotForm } from "@/components/forgot-form";

export const metadata = { title: "Reset password — DropQ" };

export default function ForgotPage() {
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a link to set a new one."
    >
      <ForgotForm />
    </AuthShell>
  );
}
