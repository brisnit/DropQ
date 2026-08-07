import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { categoryLabel } from "@/lib/category";
import type { PublicAppearance } from "@/lib/dropmeet/query";
import { REGION_TZ } from "@/lib/dropmeet/query";

/**
 * "DropQ Vendors Here" — the commerce half of a DropMeet page. Each row is a
 * vendor, when they're there, and the single most valuable action available:
 * Preorder if their drop is open, View Drop if it exists but is closed.
 */
export function VendorAppearanceList({
  appearances,
  emptyCta,
}: {
  appearances: PublicAppearance[];
  emptyCta?: React.ReactNode;
}) {
  if (appearances.length === 0) {
    return (
      <div className="bg-paper border border-dashed border-line-strong rounded-card p-8 text-center">
        <div className="text-3xl">🛍️</div>
        <h3 className="font-display font-semibold mt-3">DropQ vendors coming soon</h3>
        <p className="text-sm text-muted mt-1 max-w-sm mx-auto">
          No DropQ vendors are confirmed here yet — but this is still a real place, and we&apos;ll
          show them the moment they add an appearance.
        </p>
        {emptyCta && <div className="mt-5">{emptyCta}</div>}
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {appearances.map((a) => {
        const day = a.startDateTime.toLocaleDateString("en-US", {
          weekday: "long",
          timeZone: REGION_TZ,
        });
        const start = a.startDateTime.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: REGION_TZ,
        });
        const end = a.endDateTime?.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: REGION_TZ,
        });

        return (
          <li key={a.id} className="bg-paper border border-line rounded-card p-4">
            <div className="flex items-start gap-3">
              <Avatar name={a.seller.storeName} imageUrl={a.seller.logoUrl} seed={a.seller.id} size="lg" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/s/${a.seller.slug}`}
                  className="font-display font-semibold hover:underline block truncate"
                >
                  {a.seller.storeName}
                </Link>
                <p className="text-xs text-muted">{categoryLabel(a.seller.category)}</p>
                <p className="text-sm text-ink-soft mt-1">
                  {day} · {start}
                  {end ? `–${end}` : ""}
                </p>
                {a.boothInfo && <p className="text-xs text-muted mt-0.5">{a.boothInfo}</p>}
                {a.notes && <p className="text-sm text-muted mt-1 italic">“{a.notes}”</p>}

                {a.drop && (
                  <div className="mt-3">
                    {a.drop.canPreorder ? (
                      <Link
                        href={a.drop.href}
                        className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-pill bg-brand text-white text-sm font-semibold transition active:scale-[0.98]"
                      >
                        Preorder {a.drop.title}
                      </Link>
                    ) : (
                      <Link
                        href={a.drop.href}
                        className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold text-ink hover:border-ink/30 transition"
                      >
                        View drop
                      </Link>
                    )}
                    {a.drop.canPreorder && a.drop.closesAt && (
                      <p className="text-[11px] text-muted mt-1.5">
                        Preorders close{" "}
                        {a.drop.closesAt.toLocaleString("en-US", {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: REGION_TZ,
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
