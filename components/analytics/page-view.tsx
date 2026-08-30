"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics";

/**
 * Reports `page_viewed` on public pages. Renders nothing.
 *
 * WHY A CLIENT COMPONENT rather than a server-side count: a server render is not
 * a page view. Next prefetches, RSC payloads are fetched for links the visitor
 * never clicks, and a client-side navigation renders no new HTML document at
 * all. Counting renders would over-count prefetches and under-count navigation.
 * `usePathname()` fires exactly when a person actually lands somewhere.
 *
 * ⚠️ Mounted with `enabled` decided on the SERVER. When ANALYTICS_MODE is off —
 * which it is everywhere today — this sends nothing, rather than sending a
 * beacon the sink will silently refuse. No wasted request, no cookie, no
 * behaviour a privacy policy would have to describe.
 */
export function PageView({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const lastReported = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !pathname) return;
    // React runs effects twice in development. A page view is a count, so a
    // duplicate is a wrong number, not a harmless repeat.
    if (lastReported.current === pathname) return;
    if (!isPublicPath(pathname)) return;
    lastReported.current = pathname;
    track("page_viewed", {});
  }, [enabled, pathname]);

  return null;
}

/**
 * Public pages only.
 *
 * The dashboard and admin are the product, not the funnel. Their traffic is
 * entirely vendors who have already converted, so recording it would be volume
 * that never answers the question this feature exists for — "why aren't
 * visitors becoming vendors?" — while adding a page-by-page record of what a
 * signed-in vendor does, which is not something to collect without a reason.
 */
function isPublicPath(pathname: string): boolean {
  return !/^\/(dashboard|admin|api|my|rep|messages)(\/|$)/.test(pathname);
}
