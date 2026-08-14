import Link from "next/link";
import { requireCustomer } from "@/lib/customer-auth";
import { pointsBalance, pointsByVendor, pointsHistory, POINTS_PER_DOLLAR } from "@/lib/rewards";
import { Avatar } from "@/components/avatar";

export const metadata = { title: "Rewards — My DropQ" };

export default async function RewardsPage() {
  const customer = await requireCustomer("/my/rewards");
  const [balance, byVendor, history] = await Promise.all([
    pointsBalance(customer.id),
    pointsByVendor(customer.id),
    pointsHistory(customer.id),
  ]);

  return (
    <>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-6">Rewards</h1>

      <section className="bg-ink text-cream rounded-card p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-cream/60">
          Your DropPoints
        </p>
        <p className="font-display text-5xl font-semibold mt-1.5">{balance.toLocaleString()}</p>
        <p className="text-sm text-cream/70 mt-2">
          You earn {POINTS_PER_DOLLAR} point for every $1 you spend on DropQ.
        </p>
      </section>

      {/* Stated plainly rather than dressed up as a countdown to something.
          Points genuinely can't be spent yet and pretending otherwise would be
          a promise DropQ hasn't decided how to keep. */}
      <p className="text-sm text-muted mt-4 bg-paper border border-line rounded-card p-4">
        <b className="text-ink">Points aren&apos;t redeemable yet.</b> We&apos;re still working out
        what they unlock — expect vendor-specific rewards like a free item or store credit. Your
        balance keeps building in the meantime, and everything you&apos;ve earned will count.
      </p>

      {byVendor.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold mb-3">Where you earned them</h2>
          <div className="bg-paper border border-line rounded-card divide-y divide-line">
            {byVendor.map(({ seller, points }) => (
              <Link
                key={seller!.id}
                href={`/s/${seller!.slug}`}
                className="flex items-center gap-3 p-4 hover:bg-cream transition"
              >
                <Avatar name={seller!.storeName} imageUrl={seller!.logoUrl} size="sm" seed={seller!.id} />
                <span className="flex-1 min-w-0 font-medium truncate">{seller!.storeName}</span>
                <span className="font-display font-semibold shrink-0">{points.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {history.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold mb-3">History</h2>
          <div className="bg-paper border border-line rounded-card divide-y divide-line">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {h.reason === "purchase_reversal"
                      ? "Refunded"
                      : h.seller?.storeName ?? "DropQ"}
                  </p>
                  <p className="text-xs text-muted">
                    {h.createdAt.toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                      timeZone: "America/Los_Angeles",
                    })}
                    {h.note ? ` · ${h.note}` : ""}
                  </p>
                </div>
                <span
                  className={`font-semibold shrink-0 ${h.points < 0 ? "text-muted" : "text-ink"}`}
                >
                  {h.points > 0 ? "+" : ""}
                  {h.points.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="mt-8 bg-paper border border-dashed border-line-strong rounded-card p-8 text-center">
          <p className="text-muted">
            No points yet — your first order will start the balance.
          </p>
          <Link
            href="/dropmeet"
            className="mt-4 inline-flex items-center justify-center min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold"
          >
            Find something local
          </Link>
        </div>
      )}
    </>
  );
}
