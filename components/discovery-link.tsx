"use client";

import Link from "next/link";
import { track, type DiscoveryEvent } from "@/lib/analytics";

/**
 * A discovery entry-point link that fires an analytics event on click. Used for
 * the secondary storefront link, the no-active-drops prompt, the post-checkout
 * section, and the homepage — always styled as secondary to the vendor's own CTAs.
 */
export function DiscoveryLink({
  event,
  className = "",
  children,
  href = "/discover",
}: {
  event: DiscoveryEvent;
  className?: string;
  children: React.ReactNode;
  href?: string;
}) {
  return (
    <Link href={href} onClick={() => track(event)} className={className}>
      {children}
    </Link>
  );
}
