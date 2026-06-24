import Link from "next/link";
import { Logo } from "@/components/logo";

const COLS = [
  {
    title: "Product",
    links: [
      ["Drops", "/#drops"],
      ["Online ordering", "/#features"],
      ["Fulfillment", "/#features"],
      ["Analytics", "/#features"],
      ["Pricing", "/#pricing"],
    ],
  },
  {
    title: "Who it's for",
    links: [
      ["Home bakers", "/signup"],
      ["Cottage food", "/signup"],
      ["Meal prep", "/signup"],
      ["Market vendors", "/signup"],
      ["Food creators", "/signup"],
    ],
  },
  {
    title: "Company",
    links: [
      ["Success stories", "/#stories"],
      ["Resources", "/#"],
      ["Help center", "/#"],
      ["About", "/#"],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-cream">
      <div className="max-w-6xl mx-auto px-5 py-14 grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 text-sm text-muted max-w-xs">
            The operating system for modern product drops. Sell, run drops,
            fulfill, and grow — all in one place.
          </p>
        </div>
        {COLS.map((col) => (
          <div key={col.title}>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-3">
              {col.title}
            </h4>
            <ul className="space-y-2">
              {col.links.map(([label, href]) => (
                <li key={label}>
                  <Link
                    href={href}
                    className="text-sm text-muted hover:text-ink transition"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="max-w-6xl mx-auto px-5 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted">
          <span>© {new Date().getFullYear()} DropQ. Made for food people.</span>
          <div className="flex gap-5">
            <Link href="/#" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Vendor Terms</Link>
            <Link href="/login" className="hover:text-ink">Log in</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
