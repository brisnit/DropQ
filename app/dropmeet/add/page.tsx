import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentSeller } from "@/lib/auth";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { AddPlaceForm } from "@/components/dropmeet/add-place-form";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add a place — DropMeet",
  description:
    "Know a market, brewery, church, or gathering place in San Diego County where local vendors sell? Add it to DropMeet.",
  // A submission form has no business in search results.
  robots: { index: false, follow: false },
};

export default async function AddPlacePage() {
  const [seller, customer] = await Promise.all([getCurrentSeller(), getCurrentCustomer()]);
  const signedIn = !!seller || !!customer;

  return (
    <main className="min-h-dvh bg-cream">
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-line">
        <div className="flex items-center justify-between px-4 sm:px-5 h-14">
          <Logo href="/" />
          <Link href="/dropmeet" className="text-sm font-medium text-ink-soft hover:text-ink">
            ← DropMeet
          </Link>
        </div>
      </header>

      <div className="p-4 sm:p-6 max-w-xl mx-auto">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Know a place we&apos;re missing?
        </h1>
        <p className="text-muted mt-1 mb-5">
          Markets, breweries, churches, parks, pop-up venues — anywhere local vendors gather in San
          Diego County.
        </p>
        <AddPlaceForm signedIn={signedIn} />
      </div>
    </main>
  );
}
