import { Suspense } from "react";
import Link from "next/link";
import { requireSeller, isAdminEmail } from "@/lib/auth";
import { logoutAction, acceptTermsAction } from "@/lib/actions/auth";
import { Logo } from "@/components/logo";
import { DashboardNav } from "@/components/dashboard-nav";
import { MobileNav } from "@/components/mobile-nav";
import { VerifyBanner } from "@/components/verify-banner";
import { TermsGate } from "@/components/terms-gate";
import { TERMS_VERSION } from "@/lib/terms";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const seller = await requireSeller();

  // Vendors must accept the current Vendor Agreement before using the dashboard.
  // Re-prompt anyone who hasn't accepted, or who accepted an older version.
  if (!seller.termsAcceptedAt || seller.termsVersion !== TERMS_VERSION) {
    return <TermsGate action={acceptTermsAction} />;
  }

  const admin = seller.isAdmin || isAdminEmail(seller.email);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_1fr]">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex md:border-r border-line bg-cream md:h-screen md:sticky md:top-0 flex-col">
        <div className="px-5 py-4 border-b border-line/70">
          <Logo href="/dashboard" />
        </div>
        <div className="p-4 flex-1">
          <DashboardNav />
          {admin && (
            <Link
              href="/admin"
              className="flex items-center gap-3 px-3 py-2.5 mt-1 rounded-xl text-sm font-medium text-brand hover:bg-brand-tint/60 transition"
            >
              <span className="text-base leading-none">🛡️</span> DropQ Admin
            </Link>
          )}
        </div>
        <div className="p-4 border-t border-line/70 space-y-3">
          {/* View Your Store — single, prominent storefront CTA */}
          <Link
            href={`/s/${seller.slug}`}
            target="_blank"
            className="block rounded-xl bg-ink text-cream px-4 py-3 hover:bg-ink-soft transition"
          >
            <span className="flex items-center justify-between text-sm font-semibold">
              View Your Store <span aria-hidden>↗</span>
            </span>
            <span className="block text-xs text-cream/70 mt-0.5">
              See your storefront exactly as customers see it.
            </span>
          </Link>

          {/* Account + logout (always the last item) */}
          <div className="pt-1">
            <p className="text-sm font-medium truncate">{seller.storeName}</p>
            <p className="text-xs text-muted truncate mb-2">{seller.email}</p>
            <form action={logoutAction}>
              <button className="w-full inline-flex items-center gap-2 text-sm font-medium text-ink-soft hover:text-brand hover:bg-line/60 rounded-lg px-3 py-2.5 transition">
                <span aria-hidden className="text-base leading-none">↩</span> Log out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0">
        {/* Mobile top bar — logo + hamburger (replaces the scrolling nav) */}
        <div className="md:hidden sticky top-0 z-30 bg-cream/95 backdrop-blur border-b border-line">
          <div className="flex items-center justify-between px-5 h-14">
            <Logo href="/dashboard" />
            <MobileNav admin={admin} slug={seller.slug} />
          </div>
        </div>
        <Suspense fallback={null}>
          <VerifyBanner verified={seller.emailVerified} />
        </Suspense>
        {children}
      </main>
    </div>
  );
}
