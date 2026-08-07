import Link from "next/link";
import { requireCustomer } from "@/lib/customer-auth";
import { dropHistory } from "@/lib/my-dropq";
import { formatMoney } from "@/lib/format";
import { Avatar } from "@/components/avatar";

export const metadata = { title: "Drop history — My DropQ" };

const TZ = "America/Los_Angeles";

/**
 * Drop History. Deliberately not a second orders list — it's the collection of
 * limited releases this person was actually part of. Drop artwork leads, the
 * money is a footnote, and it's grouped by drop rather than by transaction
 * because joining a drop is the thing worth remembering.
 */
export default async function DropHistoryPage() {
  const customer = await requireCustomer("/my/history");
  const drops = await dropHistory(customer.id);

  if (drops.length === 0) {
    return (
      <div className="bg-paper border border-dashed border-line-strong rounded-card p-10 text-center">
        <div className="text-4xl">🎞️</div>
        <h1 className="font-display text-xl font-semibold mt-3">No drops yet</h1>
        <p className="text-muted mt-2 max-w-sm mx-auto">
          Every limited release you take part in gets collected here.
        </p>
        <Link
          href="/dropmeet"
          className="mt-5 inline-flex items-center justify-center min-h-[48px] px-6 rounded-pill bg-ink text-cream text-sm font-semibold"
        >
          Find a drop
        </Link>
      </div>
    );
  }

  const vendors = new Set(drops.map((d) => d.seller.id)).size;

  return (
    <>
      <header className="mb-6">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
          Your drop history
        </h1>
        <p className="text-muted mt-1">
          {drops.length} drop{drops.length === 1 ? "" : "s"} across {vendors} vendor
          {vendors === 1 ? "" : "s"}.
        </p>
      </header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {drops.map((d) => (
          <Link
            key={d.dropId}
            href={d.href}
            className="group bg-paper border border-line rounded-card overflow-hidden hover:border-ink/25 transition"
          >
            <div className="relative">
              {d.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.image}
                  alt=""
                  className="w-full h-44 object-cover group-hover:scale-[1.02] transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-44 bg-grey-tint flex items-center justify-center text-4xl">
                  🎁
                </div>
              )}
              <span className="absolute top-3 left-3 text-[11px] font-bold uppercase tracking-wide bg-paper/95 backdrop-blur px-2.5 py-1 rounded-pill">
                {d.date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: TZ,
                })}
              </span>
            </div>

            <div className="p-4">
              <div className="flex items-center gap-2">
                <Avatar
                  name={d.seller.storeName}
                  imageUrl={d.seller.logoUrl}
                  size="sm"
                  seed={d.seller.id}
                />
                <span className="text-xs text-muted truncate">{d.seller.storeName}</span>
              </div>

              <h2 className="font-display font-semibold mt-2 leading-snug">{d.title}</h2>

              <ul className="mt-2 text-sm text-ink-soft space-y-0.5">
                {d.items.slice(0, 3).map((i, n) => (
                  <li key={n} className="truncate">
                    <span className="text-muted">{i.quantity}×</span> {i.name}
                  </li>
                ))}
                {d.items.length > 3 && (
                  <li className="text-xs text-muted">+{d.items.length - 3} more</li>
                )}
              </ul>

              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-line">
                <span className="text-xs text-muted truncate">{d.place ?? "Pickup"}</span>
                <span className="text-sm font-semibold shrink-0">{formatMoney(d.totalCents)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
