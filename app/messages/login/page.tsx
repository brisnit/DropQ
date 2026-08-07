import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { CustomerLoginForm } from "@/components/customer-login-form";
import { Logo } from "@/components/logo";

export const metadata = { title: "Your messages — DropQ" };

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const { next, expired } = await searchParams;

  // Already signed in — skip the form.
  const customer = await getCurrentCustomer();
  if (customer) redirect(next && next.startsWith("/") ? next : "/messages");

  return (
    <main className="min-h-dvh bg-cream">
      <div className="px-5 h-14 flex items-center border-b border-line bg-paper">
        <Logo href="/" />
      </div>
      <div className="p-5 sm:p-8 max-w-md mx-auto">
        <CustomerLoginForm next={next ?? "/messages"} expired={expired === "1"} />
      </div>
    </main>
  );
}
