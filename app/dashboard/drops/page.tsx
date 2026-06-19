import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteDropAction } from "@/lib/actions/dashboard";
import { formatMoney, formatDate, statusStyle } from "@/lib/format";
import { PageHeader, EmptyState, Section } from "@/components/dashboard-ui";
import { LinkButton, Badge } from "@/components/ui";
import { ConfirmSubmit } from "@/components/confirm-submit";

export const metadata = { title: "Drops — DropQ" };

export default async function DropsPage() {
  const seller = await requireSeller();
  const drops = await prisma.drop.findMany({
    where: { sellerId: seller.id },
    orderBy: { createdAt: "desc" },
    include: {
      products: true,
      orders: { select: { totalCents: true } },
    },
  });

  return (
    <Section>
      <PageHeader
        title="Drops"
        subtitle="Each drop is a menu you sell in a window. Create one, share the link, sell out."
        action={<LinkButton href="/dashboard/drops/new">+ New drop</LinkButton>}
      />

      {drops.length === 0 ? (
        <EmptyState
          emoji="🔥"
          title="No drops yet"
          body="A drop is a limited menu available for a set time. Build your first one in a couple of minutes."
          ctaHref="/dashboard/drops/new"
          ctaLabel="Create your first drop"
        />
      ) : (
        <div className="space-y-3">
          {drops.map((d) => {
            const revenue = d.orders.reduce((s, o) => s + o.totalCents, 0);
            const sold = d.products.reduce((s, p) => s + p.sold, 0);
            const stock = d.products.reduce((s, p) => s + p.inventory, 0);
            const orderCount = d.orders.length;
            const confirmMsg =
              `Delete “${d.title}”` +
              (orderCount ? ` and its ${orderCount} order${orderCount !== 1 ? "s" : ""}` : "") +
              `? This can't be undone.`;
            return (
              <div key={d.id} className="flex items-stretch gap-2">
                <Link
                  href={`/dashboard/drops/${d.id}`}
                  className="flex-1 min-w-0 block bg-paper border border-line rounded-card p-5 hover:border-ink/25 hover:shadow-[var(--shadow-soft)] transition"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <h3 className="font-display text-lg font-semibold truncate">{d.title}</h3>
                        <Badge className={statusStyle(d.status)}>{d.status}</Badge>
                      </div>
                      <p className="text-sm text-muted mt-1">
                        {d.products.length} item{d.products.length !== 1 ? "s" : ""} ·{" "}
                        {d.fulfillment} · created {formatDate(d.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-6 text-right">
                      <div>
                        <p className="text-xs text-muted">Sold</p>
                        <p className="font-semibold">{sold}/{stock}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Orders</p>
                        <p className="font-semibold">{orderCount}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Revenue</p>
                        <p className="font-semibold">{formatMoney(revenue)}</p>
                      </div>
                    </div>
                  </div>
                </Link>

                <form action={deleteDropAction} className="flex">
                  <input type="hidden" name="dropId" value={d.id} />
                  <ConfirmSubmit
                    message={confirmMsg}
                    className="h-full px-3 rounded-card border border-line text-muted hover:text-white hover:bg-brand hover:border-brand transition grid place-items-center"
                  >
                    <span aria-label="Delete drop" title="Delete drop">🗑</span>
                  </ConfirmSubmit>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
