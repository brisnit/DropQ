import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteDropAction, duplicateDropAction } from "@/lib/actions/dashboard";
import { formatMoney, formatDate, statusStyle } from "@/lib/format";
import { PageHeader, EmptyState, Section } from "@/components/dashboard-ui";
import { LinkButton, Badge } from "@/components/ui";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { effectivePlan, canCreateDrop, dropsRemaining, STARTER_DROP_LIMIT } from "@/lib/plans";

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

  const isStarter = effectivePlan(seller) === "starter";
  const remaining = dropsRemaining(seller);
  const atLimit = !canCreateDrop(seller);

  // Flag published preorder drops whose close time has already passed, and show
  // schedule times in the store's timezone (not the server's UTC).
  const now = new Date();
  const tz = seller.timezone || undefined;
  const fmtWhen = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(d)
      : null;

  return (
    <Section>
      <PageHeader
        title="Drops"
        subtitle="A regular drop is a preorder window. A live drop takes on-site orders via QR in real time."
        action={
          atLimit ? (
            <LinkButton href="/dashboard/billing">⭐ Upgrade for unlimited</LinkButton>
          ) : (
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/dashboard/drops/new" variant="secondary">
                + Regular drop
              </LinkButton>
              <LinkButton href="/dashboard/drops/new?mode=live">🟢 Live selling drop</LinkButton>
            </div>
          )
        }
      />

      {isStarter && (
        <div className="mb-5 text-sm rounded-xl bg-cream border border-line px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-ink-soft">
            {atLimit ? (
              <>You&apos;ve used all <b>{STARTER_DROP_LIMIT}</b> Starter drops.</>
            ) : (
              <>Starter plan · <b>{remaining}</b> of {STARTER_DROP_LIMIT} lifetime drops remaining.</>
            )}
          </span>
          <Link href="/dashboard/billing" className="text-brand font-medium hover:underline">
            Upgrade to Growth →
          </Link>
        </div>
      )}

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
            // Live (published) preorder drop whose close time is already past →
            // customers can't order even though it shows "live".
            const closePassed =
              d.status === "live" && d.mode !== "live" && !!d.closesAt && d.closesAt < now;
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
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="font-display text-lg font-semibold truncate">{d.title}</h3>
                        <Badge className={statusStyle(d.status)}>{d.status}</Badge>
                        {d.mode === "live" && <Badge className="bg-quad/15 text-tertiary">🟢 live</Badge>}
                        {closePassed && (
                          <Badge className="bg-brand-tint text-brand-dark">⚠ Closing time passed</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted mt-1">
                        {d.products.length} item{d.products.length !== 1 ? "s" : ""} ·{" "}
                        {d.fulfillment} · created {formatDate(d.createdAt)}
                      </p>
                      {d.mode !== "live" && d.closesAt && (
                        <p className={`text-xs mt-0.5 ${closePassed ? "text-brand-dark font-medium" : "text-muted"}`}>
                          {closePassed ? "Closed" : "Closes"} {fmtWhen(d.closesAt)}
                          {closePassed && " — edit the drop to reopen or re-schedule."}
                        </p>
                      )}
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

                <form action={duplicateDropAction} className="flex">
                  <input type="hidden" name="dropId" value={d.id} />
                  <button
                    type="submit"
                    aria-label="Relaunch drop"
                    title="Relaunch — copy into a new draft"
                    className="h-full px-3 rounded-card border border-line text-muted hover:text-ink hover:border-ink/30 transition grid place-items-center"
                  >
                    <span aria-hidden>🔁</span>
                  </button>
                </form>

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
