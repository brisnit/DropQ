"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The admin header navigation.
 *
 * ── WHY THIS IS A CLIENT COMPONENT ────────────────────────────────────────
 *
 * Only to know which item is current. A layout gets no pathname prop in the
 * App Router, so `usePathname` is the way, and that needs a client boundary.
 * It is this nav alone — the layout around it stays a server component, and
 * the admin pages it frames are unaffected.
 *
 * ── ONE ROW, BOTH BREAKPOINTS ─────────────────────────────────────────────
 *
 * There is no separate mobile menu here and deliberately so: the row is
 * `overflow-x-auto` with `whitespace-nowrap` items, so on a phone it becomes a
 * horizontally scrollable strip of the same links rather than a hamburger
 * hiding them. Adding an item is therefore safe at every width — it scrolls
 * rather than wrapping or pushing the logo and sign-out controls off screen.
 */

const NAV: { href: string; label: string; exact?: boolean }[] = [
  // Exact: /admin is the prefix of every other admin route, so without this
  // "Vendors" would light up on all of them.
  { href: "/admin", label: "Vendors", exact: true },
  { href: "/admin/activation", label: "Activation" },
  { href: "/admin/sales-reps", label: "Sales Reps" },
  { href: "/admin/commissions", label: "Commissions" },
  // DropMeet had no entry here at all: /admin/dropmeet was reachable only by
  // typing the URL. This is the way in, and the review queue is one click from
  // the places list.
  { href: "/admin/dropmeet/places", label: "Manage Places" },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin"
      className="order-last sm:order-none w-full sm:w-auto min-w-0 -mx-1 sm:mx-0 flex items-center gap-1 text-sm overflow-x-auto"
    >
      {NAV.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition ${
              active
                ? "bg-cream text-ink font-semibold"
                : "text-cream/80 hover:text-cream hover:bg-white/10"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
