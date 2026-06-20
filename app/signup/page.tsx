import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { signupAction } from "@/lib/actions/auth";
import { getCurrentSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

export const metadata = { title: "Start your store — DropQ" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  if (await getCurrentSeller()) redirect("/dashboard");

  const { ref } = await searchParams;
  let referrerName: string | null = null;
  if (ref) {
    const referrer = await prisma.seller.findUnique({
      where: { referralCode: ref.trim() },
      select: { storeName: true },
    });
    referrerName = referrer?.storeName ?? null;
  }

  return (
    <AuthShell
      title="Start selling in minutes"
      subtitle="Create your store, build a drop, and share one link. No code, no monthly fee to start."
    >
      {referrerName && (
        <div className="mb-5 rounded-xl bg-sage-tint text-sage px-4 py-3 text-sm font-medium">
          🎁 <b>{referrerName}</b> invited you to DropQ. Sign up to start selling!
        </div>
      )}
      <AuthForm mode="signup" action={signupAction} referralCode={ref ?? undefined} />
    </AuthShell>
  );
}
