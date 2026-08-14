import { Suspense } from "react";
import Link from "next/link";
import { requireSeller, isAdminEmail } from "@/lib/auth";
import { salesRepForSeller } from "@/lib/sales-rep";
import { logoutAction, acceptTermsAction } from "@/lib/actions/auth";
import { Logo } from "@/components/logo";
import { DashboardNav } from "@/components/dashboard-nav";
import { MobileNav } from "@/components/mobile-nav";
import { VerifyBanner } from "@/components/verify-banner";
import { TermsGate } from "@/components/terms-gate";
import { TERMS_VERSION } from "@/lib/terms";
import { NotificationBell } from "@/components/notification-bell";
import { vendorUnreadTotal } from "@/lib/messaging";
import { listNotifications, unreadNotificationCount, notificationHref } from "@/lib/notification-center";
import { markAllNotificationsReadAction } from "@/lib/actions/messages";

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
  // Show the Referral Dashboard link only to an active linked sales rep.
  const isRep = !!(await salesRepForSeller(seller));

  const viewer = { kind: "vendor", sellerId: seller.id } as const;
  const [unread, notifications, notificationUnread] = await Promise.all([
    vendorUnreadTotal(seller.id),
    listNotifications(viewer),
    unreadNotificationCount(viewer),
  ]);
  const bellItems = notifications.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    href: notificationHref(viewer, n),
    createdAt: n.createdAt.toISOString(),
    read: !!n.readAt,
  }));

  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_1fr]">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex md:border-r border-line bg-cream md:h-screen md:sticky md:top-0 flex-col">
        <div className="px-5 py-4 border-b border-line/70">
          <Logo href="/dashboard" />
        </div>
        {/* min-h-0 + overflow-y-auto: without these the nav grows past the
            h-screen aside and pushes "View Your Store" and "Log out" off the
            bottom of the viewport, where they can't be reached. */}
        <div className="p-4 flex-1 min-h-0 overflow-y-auto">
          <DashboardNav unread={unread} />
          {isRep && (
            <>
              <div className="my-1 border-t border-line/70" aria-hidden />
              <Link
                href="/dashboard/referrals"
                className="block px-3 py-2.5 rounded-xl text-sm font-medium text-ink hover:bg-line/60 transition"
              >
                Referral Dashboard
              </Link>
            </>
          )}
          {admin && (
            <>
              <div className="my-1 border-t border-line/70" aria-hidden />
              <Link
                href="/admin"
                className="block px-3 py-2.5 rounded-xl text-sm font-medium text-brand hover:bg-brand-tint/60 transition"
              >
                DropQ Admin
              </Link>
            </>
          )}
        </div>
        <div className="p-4 border-t border-line/70 space-y-3 shrink-0">
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

          {/* Log out CTA */}
          <form action={logoutAction}>
            <button className="w-full text-center border border-line-strong rounded-xl px-3 py-2.5 text-sm font-medium text-ink hover:bg-line/50 transition">
              Log out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0">
        {/* Mobile top bar — logo + hamburger (replaces the scrolling nav) */}
        <div className="md:hidden sticky top-0 z-30 bg-cream/95 backdrop-blur border-b border-line">
          <div className="flex items-center justify-between px-5 h-14">
            <Logo href="/dashboard" />
            <div className="flex items-center gap-1">
              <NotificationBell
                viewer="vendor"
                initialItems={bellItems}
                initialUnread={notificationUnread}
                markAllAction={markAllNotificationsReadAction}
              />
              <MobileNav admin={admin} isRep={isRep} slug={seller.slug} unread={unread} />
            </div>
          </div>
        </div>
        {/* Desktop chrome. Lives in <main>, not the sidebar, so the bell sits
            at the far right of the screen on every dashboard page. Height
            matches the mobile bar (3.5rem) so full-height pages can use one
            calc for both breakpoints. */}
        <div className="hidden md:flex sticky top-0 z-30 h-14 items-center justify-end px-5 bg-cream/95 backdrop-blur border-b border-line">
          <NotificationBell
            viewer="vendor"
            initialItems={bellItems}
            initialUnread={notificationUnread}
            markAllAction={markAllNotificationsReadAction}
          />
        </div>

        <Suspense fallback={null}>
          <VerifyBanner verified={seller.emailVerified} />
        </Suspense>
        {children}
      </main>
    </div>
  );
}
