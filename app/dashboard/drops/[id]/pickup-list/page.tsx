import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSeller } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Pickup list — DropQ" };

/**
 * The printable pickup sheet for one drop.
 *
 * ── WHAT IT IS FOR ────────────────────────────────────────────────────────
 *
 * A vendor standing at a table with a stack of boxes and a pen. They need to
 * find a name, hand over the right items, and cross it off. That is the whole
 * job, and everything here follows from it: names in alphabetical order so a
 * person can be found without reading the whole page, a tick box big enough
 * to mark with a pen, and no colour, shadow or chrome that costs ink and says
 * nothing.
 *
 * ── WHY A PAGE AND NOT A CSV ──────────────────────────────────────────────
 *
 * A CSV has to be opened, formatted and fought with before it can be printed,
 * usually on a phone, usually at the worst moment. This is one tap to print.
 * The orders CSV already exists at /api/export/orders for anyone who wants
 * the data instead of the sheet.
 *
 * Paid orders only. An unpaid order is not someone to hand goods to, and a
 * sheet that lists them invites exactly that mistake.
 */
export default async function PickupListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seller = await requireSeller();

  const drop = await prisma.drop.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      sellerId: true,
      fulfillment: true,
      pickupStartAt: true,
      pickupEndAt: true,
      orders: {
        where: { paymentStatus: "paid" },
        select: {
          id: true,
          buyerName: true,
          buyerPhone: true,
          note: true,
          totalCents: true,
          status: true,
          items: { select: { name: true, quantity: true } },
        },
      },
    },
  });
  // Scoped to the signed-in vendor: another vendor's drop id must not reveal
  // their customers' names, which is what this page is made of.
  if (!drop || drop.sellerId !== seller.id) notFound();

  // Alphabetical, because the sheet is searched by name, not by order time.
  const orders = [...drop.orders].sort((a, b) =>
    (a.buyerName || "").localeCompare(b.buyerName || "")
  );

  const totalItems = orders.reduce(
    (n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0),
    0
  );

  /** What to make, totalled across every order — the packing summary. */
  const byItem = new Map<string, number>();
  for (const o of orders) {
    for (const i of o.items) byItem.set(i.name, (byItem.get(i.name) ?? 0) + i.quantity);
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Screen-only chrome. `print:hidden` keeps the page itself clean. */}
      <div className="print:hidden border-b border-line bg-cream">
        <div className="max-w-3xl mx-auto px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/dashboard/drops/${drop.id}`}
            className="inline-flex items-center min-h-11 text-sm font-medium text-muted hover:text-ink"
          >
            ← Back to drop
          </Link>
          <PrintButton />
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-5 py-8 print:py-0 print:px-0">
        <header className="pb-4 border-b-2 border-ink">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {drop.title}
          </h1>
          <p className="text-sm text-muted mt-1">
            Pickup list · {orders.length} {orders.length === 1 ? "order" : "orders"} ·{" "}
            {totalItems} {totalItems === 1 ? "item" : "items"}
          </p>
        </header>

        {orders.length === 0 ? (
          <p className="mt-8 text-muted">
            No paid orders yet. Paid orders appear here, ready to print.
          </p>
        ) : (
          <>
            {/* What to make, before who gets it. A vendor packs by item and
                hands over by name, so the sheet answers both in that order. */}
            <section className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                To prepare
              </h2>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {[...byItem.entries()].map(([name, qty]) => (
                  <li key={name}>
                    <span className="font-semibold tabular-nums">{qty}×</span> {name}
                  </li>
                ))}
              </ul>
            </section>

            <table className="w-full mt-6 text-sm border-collapse">
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="w-10 py-2 font-semibold">✓</th>
                  <th scope="col" className="py-2 font-semibold">Name</th>
                  <th scope="col" className="py-2 font-semibold">Order</th>
                  <th scope="col" className="py-2 font-semibold text-right">Paid</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  // break-inside-avoid: a row split across two sheets of paper
                  // is a customer who gets missed.
                  <tr key={o.id} className="border-b border-line align-top break-inside-avoid">
                    <td className="py-3">
                      <span
                        className="block w-5 h-5 border-2 border-ink rounded-[3px]"
                        aria-hidden
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <span className="font-semibold">{o.buyerName || "—"}</span>
                      {o.buyerPhone && (
                        <span className="block text-xs text-muted">{o.buyerPhone}</span>
                      )}
                      {o.status === "completed" && (
                        <span className="block text-xs text-muted">already collected</span>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      {o.items.map((i) => (
                        <span key={i.name} className="block">
                          <span className="font-semibold tabular-nums">{i.quantity}×</span>{" "}
                          {i.name}
                        </span>
                      ))}
                      {o.note && (
                        <span className="block text-xs text-muted mt-1">Note: {o.note}</span>
                      )}
                    </td>
                    <td className="py-3 text-right tabular-nums whitespace-nowrap">
                      {formatMoney(o.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-6 text-xs text-muted print:mt-10">
              Paid orders only · printed from DropQ
            </p>
          </>
        )}
      </main>
    </div>
  );
}
