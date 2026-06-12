import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ResetForm } from "@/components/reset-form";

export const metadata = { title: "Set a new password — DropQ" };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthShell title="Invalid reset link" subtitle="This link is missing or malformed.">
        <p className="text-sm text-muted">
          Request a fresh link from the{" "}
          <Link href="/forgot" className="text-brand font-medium hover:underline">
            forgot password
          </Link>{" "}
          page.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Pick something you'll remember.">
      <ResetForm token={token} />
    </AuthShell>
  );
}
