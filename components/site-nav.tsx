import Link from "next/link";
import { Logo } from "@/components/logo";
import { LinkButton } from "@/components/ui";
import { getCurrentSeller } from "@/lib/auth";

const LINKS = [
  { href: "/discover", label: "Find Drops" },
  { href: "/#how", label: "How It Works" },
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
];

export async function SiteNav() {
  const seller = await getCurrentSeller();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/80 backdrop-blur-md">
      <nav className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-6">
        <Logo />
        <div className="hidden md:flex items-center gap-7 text-sm font-medium text-ink-soft">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink transition">
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {seller ? (
            <LinkButton href="/dashboard" size="sm">
              Go to dashboard
            </LinkButton>
          ) : (
            <>
              <LinkButton href="/login" variant="secondary" size="sm">
                Log in
              </LinkButton>
              <LinkButton href="/signup" size="sm">
                Start selling
              </LinkButton>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
