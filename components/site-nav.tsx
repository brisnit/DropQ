import Link from "next/link";
import { Logo } from "@/components/logo";
import { LinkButton } from "@/components/ui";
import { getCurrentSeller } from "@/lib/auth";
import { SiteNavMobile } from "@/components/site-nav-mobile";
import { SITE_LINKS } from "@/lib/site-links";

export async function SiteNav() {
  const seller = await getCurrentSeller();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/80 backdrop-blur-md">
      <nav className="max-w-6xl mx-auto px-4 sm:px-5 h-16 flex items-center justify-between gap-2 sm:gap-6">
        <div className="flex items-center min-w-0">
          <Logo />
        </div>
        <div className="hidden md:flex items-center gap-7 text-sm font-medium text-ink-soft">
          {SITE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink transition">
              {l.label}
            </Link>
          ))}
        </div>
        {/* shrink-0: the CTAs keep their natural width and the logo yields
            instead, which is what made the labels wrap at 320px. */}
        {/* The menu sits at the far right, after the CTAs — the corner a
            thumb reaches most easily on a phone, and the side the panel
            opens from. It is the only route to the rest of the site below md. */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {seller ? (
            <LinkButton href="/dashboard" size="sm" className="px-3.5 sm:px-4">
              <span className="sm:hidden">Dashboard</span>
              <span className="hidden sm:inline">Go to dashboard</span>
            </LinkButton>
          ) : (
            <>
              {/* Plain text link on phones, pill from sm up. Dropping the pill
                  frees the ~32px of horizontal padding that "Start selling"
                  needs to stay on one line at 320px. */}
              <Link
                href="/login"
                className="inline-flex items-center justify-center whitespace-nowrap min-h-11 px-1.5 text-sm font-medium text-ink-soft hover:text-ink transition sm:px-4 sm:rounded-pill sm:text-white sm:bg-secondary sm:hover:bg-[#5b5d5f]"
              >
                Log in
              </Link>
              <LinkButton href="/signup" size="sm" className="px-3.5 sm:px-4">
                Start selling
              </LinkButton>
            </>
          )}
          <SiteNavMobile />
        </div>
      </nav>
    </header>
  );
}
