"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/drops", label: "Drops" },
  { href: "/dashboard/orders", label: "Orders" },
  { href: "/dashboard/customers", label: "Customers" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/payments", label: "Payments" },
  { href: "/dashboard/billing", label: "Plan" },
  { href: "/dashboard/store", label: "Store" },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col">
      {NAV.map((item, i) => {
        const active = isActive(pathname, item.href, item.exact);
        return (
          <Fragment key={item.href}>
            <Link
              href={item.href}
              className={`px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                active
                  ? "bg-ink text-cream"
                  : "text-ink-soft hover:bg-line/70 hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
            {i < NAV.length - 1 && (
              <div className="my-1 border-t border-line/70" aria-hidden />
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
