import type { Metadata } from "next";
import Link from "next/link";
import { dropMeetFeed } from "@/lib/dropmeet/query";
import { DropMeetExplorer } from "@/components/dropmeet/explorer";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "DropMeet — Local markets, vendors & drops in San Diego",
  description:
    "Discover local markets, vendors, drops, and gathering places across San Diego County. Find farmers markets, flea markets, vintage and makers markets — and preorder from vendors before you arrive.",
  alternates: { canonical: "/dropmeet" },
  openGraph: {
    title: "DropMeet — Discover local markets, vendors, drops, and gathering places",
    description:
      "Farmers markets, flea markets, vintage and makers markets across San Diego County — plus the DropQ vendors selling there and what you can preorder.",
    url: "/dropmeet",
    type: "website",
  },
};

/**
 * Rendered per request. What's on DropMeet changes by the hour — today's
 * markets, this weekend's events, which vendors just added an appearance — so
 * prerendering it at build time would ship a stale map and force the build to
 * reach for the database.
 */
export const dynamic = "force-dynamic";

export default async function DropMeetPage() {
  const { region, items } = await dropMeetFeed({ limit: 200 });

  if (!region) {
    return (
      <main className="min-h-dvh bg-cream">
        <DropMeetHeader />
        <div className="p-8 max-w-md mx-auto text-center">
          <div className="text-4xl">🗺️</div>
          <h1 className="font-display text-2xl font-semibold mt-3">DropMeet isn&apos;t live yet</h1>
          <p className="text-muted mt-2">
            No region has been switched on. Run{" "}
            <code className="text-sm bg-grey-tint px-1.5 py-0.5 rounded">npm run db:seed-region</code>{" "}
            to activate San Diego County.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-cream">
      <DropMeetHeader />
      <DropMeetExplorer initialItems={items} regionName={region.name} />
    </main>
  );
}

function DropMeetHeader() {
  return (
    <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-line">
      <div className="flex items-center justify-between px-4 sm:px-5 h-14">
        <Logo href="/" />
        <nav className="flex items-center gap-1">
          <Link
            href="/discover"
            className="min-h-11 px-3 inline-flex items-center rounded-xl text-sm font-medium text-ink-soft hover:bg-line/60 transition"
          >
            Vendors
          </Link>
          <Link
            href="/messages"
            className="min-h-11 px-3 inline-flex items-center rounded-xl text-sm font-medium text-ink-soft hover:bg-line/60 transition"
          >
            Messages
          </Link>
        </nav>
      </div>
    </header>
  );
}
