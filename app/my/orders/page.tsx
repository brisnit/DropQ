import Link from "next/link";
import { requireCustomer } from "@/lib/customer-auth";
import { activeOrders, pastOrders } from "@/lib/my-dropq";
import { ActiveOrderCard, PastOrderRow } from "@/components/my/cards";

export const metadata = { title: "Orders — My DropQ" };

export default async function MyOrdersPage() {
  const customer = await requireCustomer("/my/orders");
  const [active, past] = await Promise.all([
    activeOrders(customer.id),
    pastOrders(customer.id),
  ]);

  if (active.length === 0 && past.length === 0) {
    return (
      <div className="bg-paper border border-dashed border-line-strong rounded-card p-10 text-center">
        <div className="text-4xl">🧾</div>
        <h1 className="font-display text-xl font-semibold mt-3">No orders yet</h1>
        <p className="text-muted mt-2 max-w-sm mx-auto">
          When you order from a DropQ vendor it shows up here, with pickup details and status.
        </p>
        <Link
          href="/dropmeet"
          className="mt-5 inline-flex items-center justify-center min-h-[48px] px-6 rounded-pill bg-ink text-cream text-sm font-semibold"
        >
          Find something to order
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-6">Orders</h1>

      {/* Active and past are visually distinct on purpose — an order you still
          have to collect is a completely different thing from a receipt. */}
      {active.length > 0 && (
        <section className="mb-9">
          <h2 className="font-display text-lg font-semibold mb-3">Active</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {active.map((o) => (
              <ActiveOrderCard key={o.id} order={o} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold mb-3">Past orders</h2>
          <div className="space-y-2">
            {past.map((o) => (
              <PastOrderRow key={o.id} order={o} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
