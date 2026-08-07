import Link from "next/link";
import { requireCustomer } from "@/lib/customer-auth";
import { myDropQHome } from "@/lib/my-dropq";
import { dropMeetFeed } from "@/lib/dropmeet/query";
import { customerLabel } from "@/lib/messaging-shared";
import { DropMeetCard } from "@/components/dropmeet/card";
import {
  Rail,
  ActiveOrderCard,
  DropCard,
  VendorCard,
  EmptyRail,
} from "@/components/my/cards";

export const metadata = { title: "My DropQ" };

export default async function MyDropQHome() {
  const customer = await requireCustomer("/my");
  const [home, dropmeet] = await Promise.all([
    myDropQHome(customer.id),
    dropMeetFeed({ limit: 8, filters: ["weekend"] }),
  ]);

  const firstName = customerLabel(customer).split(" ")[0];
  const hasAnything =
    home.active.length > 0 || home.vendors.length > 0 || home.historyCount > 0;

  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
          Hey {firstName} 👋
        </h1>
        <p className="text-muted mt-1">
          {home.active.length > 0
            ? `You've got ${home.active.length} order${home.active.length === 1 ? "" : "s"} on the way.`
            : "Here's what's dropping around you."}
        </p>
      </header>

      {/* Orders in flight lead — "what's happening next" is the first question. */}
      {home.active.length > 0 && (
        <Rail title="Happening next" action={{ href: "/my/orders", label: "All orders" }}>
          {home.active.map((o) => (
            <ActiveOrderCard key={o.id} order={o} />
          ))}
        </Rail>
      )}

      {/* Drops from vendors they follow — the payoff for following. */}
      <Rail title="From vendors you follow" action={home.vendors.length ? { href: "/my/saved", label: "Manage" } : undefined}>
        {home.upcoming.length > 0 ? (
          home.upcoming.map((d) => <DropCard key={d.id} drop={d} />)
        ) : (
          <EmptyRail
            text={
              home.vendors.length > 0
                ? "None of the vendors you follow have a live drop right now. You'll see them here first."
                : "Follow a vendor and their next drop shows up here before anyone tells you."
            }
            cta={{ href: "/dropmeet", label: "Find vendors" }}
          />
        )}
      </Rail>

      {/* Who they follow */}
      {home.vendors.length > 0 && (
        <Rail title="Vendors you follow" action={{ href: "/my/saved", label: "See all" }}>
          {home.vendors.map((v) => (
            <VendorCard key={v.sellerId} vendor={v} />
          ))}
        </Rail>
      )}

      {/* Local discovery, pulled straight from DropMeet — same product. */}
      <section className="mb-9">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-display text-lg font-semibold">Around you this weekend</h2>
          <Link href="/dropmeet" className="text-sm font-medium text-brand hover:underline shrink-0">
            Open DropMeet
          </Link>
        </div>
        {dropmeet.items.length > 0 ? (
          <div className="bg-paper border border-line rounded-card overflow-hidden">
            {dropmeet.items.slice(0, 5).map((i) => (
              <DropMeetCard key={i.id} item={i} />
            ))}
          </div>
        ) : (
          <EmptyRail
            text="Nothing scheduled this weekend yet. DropMeet is just getting going in San Diego County."
            cta={{ href: "/dropmeet", label: "Browse DropMeet" }}
          />
        )}
      </section>

      {/* Drop history teaser */}
      {home.historyCount > 0 && (
        <section className="mb-9">
          <Link
            href="/my/history"
            className="flex items-center justify-between gap-4 bg-ink text-cream rounded-card p-5 hover:bg-ink-soft transition"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-cream/60">
                Your drop history
              </p>
              <p className="font-display text-xl font-semibold mt-1">
                {home.historyCount} drop{home.historyCount === 1 ? "" : "s"} joined
              </p>
              <p className="text-sm text-cream/70 mt-0.5">
                Every limited release you were part of.
              </p>
            </div>
            <span aria-hidden className="text-2xl shrink-0">
              →
            </span>
          </Link>
        </section>
      )}

      {!hasAnything && (
        <div className="bg-paper border border-dashed border-line-strong rounded-card p-10 text-center">
          <div className="text-4xl">🎁</div>
          <h2 className="font-display text-xl font-semibold mt-3">Nothing here yet</h2>
          <p className="text-muted mt-2 max-w-sm mx-auto">
            Once you order from a vendor or follow one, this becomes your home for what&apos;s
            dropping next.
          </p>
          <Link
            href="/dropmeet"
            className="mt-5 inline-flex items-center justify-center min-h-[48px] px-6 rounded-pill bg-ink text-cream text-sm font-semibold"
          >
            Discover local vendors
          </Link>
        </div>
      )}
    </>
  );
}
