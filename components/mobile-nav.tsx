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
  { href: "/dashboard/customers", label: "Customers" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/payments", label: "Payments" },
  { href: "/dashboard/billing", label: "Plan" },
  { href: "/dashboard/store", label: "Store" },
];

const DIVIDER = "my-1 border-t border-line/70";

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function MobileNav({ admin, isRep, slug }: { admin: boolean; isRep?: boolean; slug: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);

  const itemCls = (active: boolean) =>
    `block px-3 py-2.5 rounded-xl text-sm font-medium transition ${
      active ? "bg-ink text-cream" : "text-ink-soft hover:bg-line/70"
    }`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-11 px-2.5 -mr-1 rounded-lg text-ink-soft hover:bg-line/60 transition"
      >
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
            {NAV.map((item, i) => (
              <Fragment key={item.href}>
                <Link href={item.href} onClick={close} className={itemCls(isActive(pathname, item.href, item.exact))}>
                  {item.label}
                </Link>
                {i < NAV.length - 1 && <div className={DIVIDER} aria-hidden />}
              </Fragment>
            ))}
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
