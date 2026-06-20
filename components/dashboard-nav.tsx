"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: "◎", exact: true },
  { href: "/dashboard/drops", label: "Drops", icon: "🔥" },
  { href: "/dashboard/orders", label: "Orders", icon: "🧾" },
  { href: "/dashboard/customers", label: "Customers", icon: "👥" },
  { href: "/dashboard/analytics", label: "Analytics", icon: "📈" },
  { href: "/dashboard/payments", label: "Payments", icon: "💳" },
  { href: "/dashboard/billing", label: "Plan", icon: "⭐" },
  { href: "/dashboard/store", label: "Store", icon: "🏪" },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition ${
              active
                ? "bg-ink text-cream"
                : "text-ink-soft hover:bg-line/70 hover:text-ink"
            }`}
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
