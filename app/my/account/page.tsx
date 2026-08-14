import Link from "next/link";
import { requireCustomer, getCurrentCustomer } from "@/lib/customer-auth";
import { customerLogoutAction } from "@/lib/actions/customer-auth";
import { ProfileForm } from "@/components/my/profile-form";
import { NotificationPrefs } from "@/components/my/notification-prefs";

export const metadata = { title: "Account — My DropQ" };

export default async function AccountPage() {
  await requireCustomer("/my/account");
  // Re-read after requireCustomer so consent flags reflect the latest write.
  const customer = (await getCurrentCustomer())!;

  return (
    <>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-6">Account</h1>

      <div className="space-y-5">
        <ProfileForm
          name={customer.name ?? ""}
          email={customer.email}
          phone={customer.phone ?? ""}
        />

        <NotificationPrefs
          smsTransactional={customer.smsTransactionalConsent}
          smsMarketing={customer.smsMarketingConsent}
          optedOut={!!customer.smsOptedOutAt}
          hasPhone={!!customer.phone}
        />

        {/* Email is separate from SMS and always on for order receipts — it's
            how a receipt reaches someone who never opted into texts. */}
        <section className="bg-paper border border-line rounded-card p-5">
          <h2 className="font-display text-lg font-semibold">Email</h2>
          <p className="text-sm text-muted mt-1">
            Order receipts and pickup details are sent to {customer.email}. These are required for
            your orders and can&apos;t be turned off while you have active orders.
          </p>
        </section>

        <section className="bg-paper border border-line rounded-card p-5">
          <h2 className="font-display text-lg font-semibold">Privacy &amp; data</h2>
          <p className="text-sm text-muted mt-1">
            Read how we handle your information in our{" "}
            <Link href="/privacy" className="text-brand hover:underline">Privacy Policy</Link>, the{" "}
            <Link href="/terms" className="text-brand hover:underline">Terms</Link>, and our{" "}
            <Link href="/sms" className="text-brand hover:underline">SMS page</Link>.
          </p>
          <p className="text-sm text-muted mt-3">
            To export or delete your DropQ data, email{" "}
            <a href="mailto:support@drop-q.com" className="text-brand hover:underline">
              support@drop-q.com
            </a>{" "}
            and we&apos;ll action it. Self-serve deletion is coming.
          </p>
        </section>

        {/* Destructive/session actions kept visually apart from settings. */}
        <section className="border-t border-line pt-5">
          <form action={customerLogoutAction}>
            <button className="min-h-[44px] px-5 rounded-pill border border-line-strong text-sm font-medium text-ink-soft hover:bg-line/40 transition">
              Sign out
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
