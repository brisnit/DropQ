import Link from "next/link";
import { requireCustomer } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { customerLogoutAction } from "@/lib/actions/customer-auth";
import { formatDate } from "@/lib/format";
import { Avatar } from "@/components/avatar";
import { customerLabel } from "@/lib/messaging-shared";

export const metadata = { title: "Account — My DropQ" };

/**
 * Account overview. Phase 4 turns the greyed rows into real editors —
 * profile, addresses, notification preferences, privacy. They're listed as
 * "coming" rather than rendered as broken links so the shape of the area is
 * visible without pretending anything works.
 */
export default async function AccountPage() {
  const customer = await requireCustomer("/my/account");

  const [orderCount, vendorCount, firstVendor] = await Promise.all([
    prisma.order.count({ where: { customerId: customer.id, status: { not: "pending" } } }),
    prisma.customerVendor.count({ where: { customerId: customer.id } }),
    customer.firstVendorId
      ? prisma.seller.findUnique({
          where: { id: customer.firstVendorId },
          select: { storeName: true, slug: true },
        })
      : null,
  ]);

  const name = customerLabel(customer);

  return (
    <>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-6">Account</h1>

      <section className="bg-paper border border-line rounded-card p-5">
        <div className="flex items-center gap-4">
          <Avatar name={name} imageUrl={customer.avatarUrl} size="lg" seed={customer.id} />
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold truncate">{name}</p>
            <p className="text-sm text-muted truncate">{customer.email}</p>
            {customer.phone && <p className="text-sm text-muted">{customer.phone}</p>}
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-line text-center">
          <div>
            <dt className="text-xs text-muted uppercase tracking-wide">Orders</dt>
            <dd className="font-display text-xl font-semibold mt-0.5">{orderCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted uppercase tracking-wide">Vendors</dt>
            <dd className="font-display text-xl font-semibold mt-0.5">{vendorCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted uppercase tracking-wide">Member since</dt>
            <dd className="text-sm font-medium mt-1.5">{formatDate(customer.createdAt)}</dd>
          </div>
        </dl>

        {firstVendor && (
          <p className="text-xs text-muted mt-4 pt-4 border-t border-line">
            You found DropQ through{" "}
            <Link href={`/s/${firstVendor.slug}`} className="text-brand hover:underline">
              {firstVendor.storeName}
            </Link>
            .
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold mb-3">Settings</h2>
        <ul className="bg-paper border border-line rounded-card divide-y divide-line">
          {[
            ["Profile", "Name, photo, contact details"],
            ["Addresses", "Delivery addresses and pickup preferences"],
            ["Notifications", "What you hear about, and how"],
            ["Payments", "Saved payment methods"],
            ["Privacy & security", "Your data and sign-in"],
          ].map(([label, sub]) => (
            <li key={label} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0">
                <p className="font-medium">{label}</p>
                <p className="text-xs text-muted truncate">{sub}</p>
              </div>
              <span className="text-xs text-muted shrink-0">Coming soon</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold mb-3">Support</h2>
        <p className="text-sm text-muted">
          Need help with an order? Open it from{" "}
          <Link href="/my/orders" className="text-brand hover:underline">
            Orders
          </Link>{" "}
          and message the vendor directly — they can see exactly what you bought.
        </p>
      </section>

      {/* Destructive actions kept well away from everyday settings. */}
      <section className="mt-10 pt-6 border-t border-line">
        <form action={customerLogoutAction}>
          <button className="min-h-[48px] px-6 rounded-pill border border-line-strong text-sm font-semibold hover:border-ink/30 transition">
            Sign out
          </button>
        </form>
      </section>
    </>
  );
}
