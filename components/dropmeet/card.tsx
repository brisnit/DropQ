import Link from "next/link";
import type { DropMeetItem } from "@/lib/dropmeet/types";

/**
 * A DropMeet result. Leads with *when*, then the name, then the two facts that
 * drive the product: who's selling there and what can be preordered. No metadata
 * dump — a vendor mid-market reads this one-handed.
 */
export function DropMeetCard({
  item,
  active,
  onHover,
}: {
  item: DropMeetItem;
  active?: boolean;
  onHover?: (id: string | null) => void;
}) {
  return (
    <Link
      href={item.href}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`block px-4 py-3.5 min-h-[88px] border-b border-line transition ${
        active ? "bg-cream" : "bg-paper hover:bg-cream/60"
      }`}
    >
      <div className="flex gap-3">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt=""
            className="w-16 h-16 rounded-xl object-cover shrink-0 border border-line"
          />
        ) : (
          <div className="w-16 h-16 rounded-xl shrink-0 bg-grey-tint flex items-center justify-center text-2xl">
            {item.kind === "event" ? "🎪" : item.kind === "market" ? "🧺" : "📍"}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {item.whenLabel && (
            <p className="text-[11px] font-bold tracking-wide text-brand">{item.whenLabel}</p>
          )}
          <h3 className="font-display font-semibold truncate leading-tight mt-0.5">{item.name}</h3>
          <p className="text-xs text-muted truncate mt-0.5">
            {[item.typeLabel, item.city].filter(Boolean).join(" · ")}
          </p>

          {(item.vendorCount > 0 || item.preorderCount > 0) && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {item.vendorCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-pill bg-grey-tint text-[#3f434b] text-[11px] font-semibold">
                  {item.vendorCount} DropQ vendor{item.vendorCount === 1 ? "" : "s"}
                </span>
              )}
              {item.preorderCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-pill bg-brand-tint text-brand-dark text-[11px] font-semibold">
                  {item.preorderCount} preorder{item.preorderCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
