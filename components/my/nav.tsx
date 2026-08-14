"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * My DropQ navigation. Deliberately short — five destinations, not every
 * feature. Settings live behind Account rather than competing for top-level
 * space with the things people actually come here for.
 *
 * Scrolls horizontally on narrow screens instead of wrapping or shrinking,
 * which keeps every target a comfortable size on a phone.
 */
const ITEMS = [
  { href: "/my", label: "Home", exact: true },
  { href: "/my/orders", label: "Orders" },
  { href: "/my/saved", label: "Saved" },
  { href: "/my/rewards", label: "Rewards" },
  { href: "/messages", label: "Messages", badge: true },
  { href: "/dropmeet", label: "DropMeet" },
  { href: "/my/account", label: "Account" },
];

export function MyNav({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="flex gap-1 px-3 sm:px-4 overflow-x-auto border-t border-line/70">
      {ITEMS.map((i) => {
        const active = isActive(i.href, i.exact);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`relative shrink-0 inline-flex items-center gap-1.5 min-h-[46px] px-3 text-sm font-medium whitespace-nowrap border-b-2 transition ${
              active
                ? "border-ink text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {i.label}
            {i.badge && unreadMessages > 0 && (
              <span
                className="min-w-[18px] h-[18px] px-1 rounded-pill bg-brand text-white text-[10px] font-bold inline-flex items-center justify-center"
                aria-label={`${unreadMessages} unread`}
              >
                {unreadMessages > 9 ? "9+" : unreadMessages}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
