import { Suspense } from "react";
import Link from "next/link";
import { requireSeller, isAdminEmail } from "@/lib/auth";
import { logoutAction, acceptTermsAction } from "@/lib/actions/auth";
import { Logo } from "@/components/logo";
import { DashboardNav } from "@/components/dashboard-nav";
import { VerifyBanner } from "@/components/verify-banner";
import { TermsGate } from "@/components/terms-gate";
import { LinkButton } from "@/components/ui";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const seller = await requireSeller();

  // Vendors must accept the Vendor Agreement before using the dashboard.
  if (!seller.termsAcceptedAt) {
    return <TermsGate action={acceptTermsAction} />;
  }

  const admin = seller.isAdmin || isAdminEmail(seller.email);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="border-b md:border-b-0 md:border-r border-line bg-cream md:h-screen md:sticky md:top-0 flex flex-col">
        <div className="px-5 py-4 border-b border-line/70">
          <Logo />
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
          <Link
            href={`/s/${seller.slug}`}
            target="_blank"
            className="block rounded-xl border border-line bg-paper px-3 py-2.5 hover:border-ink/30 transition"
          >
            <span className="block text-xs text-muted">Your storefront</span>
            <span className="block text-sm font-medium truncate">
              /s/{seller.slug} ↗
            </span>
          </Link>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{seller.storeName}</p>
              <p className="text-xs text-muted truncate">{seller.email}</p>
            </div>
            <form action={logoutAction}>
              <button className="text-xs text-muted hover:text-brand transition px-2 py-1">
                Log out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0">
        <Suspense fallback={null}>
          <VerifyBanner verified={seller.emailVerified} />
        </Suspense>
        <div className="md:hidden flex items-center justify-between px-5 py-3 border-b border-line">
          <span className="font-display font-semibold">{seller.storeName}</span>
          <LinkButton href="/dashboard/drops/new" size="sm">
            + New drop
          </LinkButton>
        </div>
        {children}
      </main>
    </div>
  );
}
