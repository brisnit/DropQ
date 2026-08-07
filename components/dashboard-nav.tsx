"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * `unread` is the server-rendered starting count for the Messages badge; it's
 * refreshed on the shared polling endpoint so the sidebar stays live without a
 * page reload.
 */
export function DashboardNav({ unread = 0 }: { unread?: number }) {
  const pathname = usePathname();
  const [messageUnread, setMessageUnread] = useState(unread);

  useEffect(() => setMessageUnread(unread), [unread]);

  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/messages/poll?viewer=vendor", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { unreadTotal?: number };
        if (typeof data.unreadTotal === "number") setMessageUnread(data.unreadTotal);
      } catch {
        /* next tick retries */
      }
    };
    const id = setInterval(tick, 20000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return (
    <nav className="flex flex-col">
      {NAV.map((item, i) => {
        const active = isActive(pathname, item.href, item.exact);
        const badge = item.href === "/dashboard/messages" ? messageUnread : 0;
        return (
          <Fragment key={item.href}>
            <Link
              href={item.href}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                active
                  ? "bg-ink text-cream"
                  : "text-ink-soft hover:bg-line/70 hover:text-ink"
              }`}
            >
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
            {i < NAV.length - 1 && (
              <div className="my-1 border-t border-line/70" aria-hidden />
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
