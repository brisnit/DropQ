import Link from "next/link";
import { requireCustomer } from "@/lib/customer-auth";
import { followedVendorCards, savedPlaces } from "@/lib/my-dropq";
import { toggleVendorFollowAction } from "@/lib/actions/vendor-follow";
import { toggleLocationFollowAction, toggleMarketFollowAction } from "@/lib/actions/dropmeet";
import { VendorCard } from "@/components/my/cards";
import { locationTypeLabel, marketTypeLabel } from "@/lib/dropmeet/types";

export const metadata = { title: "Saved — My DropQ" };

export default async function SavedPage() {
  const customer = await requireCustomer("/my/saved");
  const [vendors, places] = await Promise.all([
    followedVendorCards(customer.id),
    savedPlaces(customer.id),
  ]);

  const total = vendors.length + places.markets.length + places.locations.length;

  if (total === 0) {
    return (
      <div className="bg-paper border border-dashed border-line-strong rounded-card p-10 text-center">
        <div className="text-4xl">☆</div>
        <h1 className="font-display text-xl font-semibold mt-3">Nothing saved yet</h1>
        <p className="text-muted mt-2 max-w-sm mx-auto">
          Follow a vendor to hear about their next drop, or save a market in DropMeet to keep it
          handy.
        </p>
        <Link
          href="/dropmeet"
          className="mt-5 inline-flex items-center justify-center min-h-[48px] px-6 rounded-pill bg-ink text-cream text-sm font-semibold"
        >
          Explore DropMeet
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-6">Saved</h1>

      {vendors.length > 0 && (
        <section className="mb-9">
          <h2 className="font-display text-lg font-semibold mb-3">
            Vendors you follow ({vendors.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {vendors.map((v) => (
              <div key={v.sellerId} className="flex flex-col gap-2">
                <VendorCard vendor={v} />
                <form action={toggleVendorFollowAction}>
                  <input type="hidden" name="sellerId" value={v.sellerId} />
                  <input type="hidden" name="returnTo" value="/my/saved" />
                  <button className="w-full min-h-[40px] rounded-pill border border-line-strong text-sm font-medium text-ink-soft hover:border-ink/30 transition">
                    Following
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}

      {places.markets.length > 0 && (
        <section className="mb-9">
          <h2 className="font-display text-lg font-semibold mb-3">
            Markets ({places.markets.length})
          </h2>
          <div className="space-y-2">
            {places.markets.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 bg-paper border border-line rounded-card p-3"
              >
                <Link href={m.href} className="flex items-center gap-3 min-w-0 flex-1">
                  {m.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-grey-tint shrink-0 flex items-center justify-center">
                      🧺
                    </div>
                  )}
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{m.name}</span>
                    <span className="block text-xs text-muted truncate">
                      {[marketTypeLabel(m.type), m.city].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </Link>
                <form action={toggleMarketFollowAction} className="shrink-0">
                  <input type="hidden" name="marketId" value={m.id} />
                  <button className="min-h-[40px] px-4 rounded-pill border border-line-strong text-sm font-medium text-ink-soft hover:border-ink/30 transition">
                    Following
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}

      {places.locations.length > 0 && (
        <section className="mb-9">
          <h2 className="font-display text-lg font-semibold mb-3">
            Places ({places.locations.length})
          </h2>
          <div className="space-y-2">
            {places.locations.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-3 bg-paper border border-line rounded-card p-3"
              >
                <Link href={l.href} className="flex items-center gap-3 min-w-0 flex-1">
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-grey-tint shrink-0 flex items-center justify-center">
                      📍
                    </div>
                  )}
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{l.name}</span>
                    <span className="block text-xs text-muted truncate">
                      {[locationTypeLabel(l.type), l.city].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </Link>
                <form action={toggleLocationFollowAction} className="shrink-0">
                  <input type="hidden" name="locationId" value={l.id} />
                  <button className="min-h-[40px] px-4 rounded-pill border border-line-strong text-sm font-medium text-ink-soft hover:border-ink/30 transition">
                    Following
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Saved individual drops/products aren't persisted server-side yet — the
          existing "save" is localStorage only. Flagged rather than faked. */}
      <p className="text-xs text-muted">
        Saving individual drops and products is coming — today saving works for vendors, markets and
        places.
      </p>
    </>
  );
}
