import Link from "next/link";
import { DiscoverClient } from "@/components/discover-client";

export const metadata = {
  title: "Find Drops Near You — DropQ",
  description: "Discover local vendors, product drops, pop-ups, and markets happening near you.",
};

// Public discovery page — no authentication, no customer account.
export default function DiscoverPage() {
  return (
    <main className="min-h-screen">
      {/* Minimal top bar — DropQ branding, links home */}
      <header className="border-b border-line bg-cream/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/dropq-mark.png" alt="DropQ" className="h-[22px] w-auto" />
          </Link>
          <Link href="/signup" className="text-sm font-medium text-brand hover:underline">
            Sell on DropQ →
          </Link>
        </div>
      </header>

      <DiscoverClient />

      <footer className="py-10 border-t border-line text-center text-sm text-muted">
        Powered by DropQ — the operating system for modern product drops.
      </footer>
    </main>
  );
}
