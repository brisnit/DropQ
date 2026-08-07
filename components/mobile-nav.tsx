"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions/auth";

const NAV = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/drops", label: "Drops" },
  { href: "/dashboard/products", label: "Products" },
  { href: "/dashboard/orders", label: "Orders" },
  { href: "/dashboard/messages", label: "Messages" },
  { href: "/dashboard/where-ill-be", label: "Where I'll Be" },
  { href: "/dashboard/customers", label: "Customers" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/payments", label: "Payments" },
  { href: "/dashboard/billing", label: "Plan" },
  { href: "/dashboard/store", label: "Store" },
  { href: "/dashboard/discoverability", label: "Discovery" },
];

const DIVIDER = "my-1 border-t border-line/70";

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function MobileNav({
  admin,
  isRep,
  slug,
  unread = 0,
}: {
  admin: boolean;
  isRep?: boolean;
  slug: string;
  unread?: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);

  const itemCls = (active: boolean) =>
    `flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
      active ? "bg-ink text-cream" : "text-ink-soft hover:bg-line/70"
    }`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="relative inline-flex items-center gap-1.5 h-11 px-2.5 -mr-1 rounded-lg text-ink-soft hover:bg-line/60 transition"
      >
        {/* Unread messages surface on the closed hamburger — the menu is the
            only route to Messages on mobile, so the badge has to live here. */}
        {!open && unread > 0 && (
          <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-brand border-2 border-cream" aria-hidden />
        )}
        {open ? (
          <>
            <span className="text-sm font-medium">Close</span>
            <span className="text-lg leading-none">✕</span>
          </>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-full mt-2 z-50 w-60 bg-paper border border-line rounded-2xl shadow-[var(--shadow-lift)] p-2">
            {NAV.map((item, i) => {
              const active = isActive(pathname, item.href, item.exact);
              const badge = item.href === "/dashboard/messages" ? unread : 0;
              return (
                <Fragment key={item.href}>
                  <Link href={item.href} onClick={close} className={itemCls(active)}>
                    {item.label}
                    {badge > 0 && (
                      <span
                        className={`min-w-[20px] h-5 px-1.5 rounded-pill text-[11px] font-bold inline-flex items-center justify-center ${
                          active ? "bg-cream text-ink" : "bg-brand text-white"
                        }`}
                        aria-label={`${badge} unread`}
                      >
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </Link>
                  {i < NAV.length - 1 && <div className={DIVIDER} aria-hidden />}
                </Fragment>
              );
            })}
            {isRep && (
              <>
                <div className={DIVIDER} aria-hidden />
                <Link href="/dashboard/referrals" onClick={close} className="block px-3 py-2.5 rounded-xl text-sm font-medium text-ink hover:bg-line/60 transition">
                  Referral Dashboard
                </Link>
              </>
            )}
            {admin && (
              <>
                <div className={DIVIDER} aria-hidden />
                <Link href="/admin" onClick={close} className="block px-3 py-2.5 rounded-xl text-sm font-medium text-brand hover:bg-brand-tint/60 transition">
                  DropQ Admin
                </Link>
              </>
            )}

            <div className={DIVIDER} aria-hidden />

            <Link href={`/s/${slug}`} target="_blank" onClick={close} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink-soft hover:bg-line/70 transition">
              View Your Store <span aria-hidden>↗</span>
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium text-ink-soft hover:bg-brand-tint/60 hover:text-brand transition">
                Log out
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
