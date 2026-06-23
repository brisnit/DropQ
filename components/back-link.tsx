import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Back navigation styled as a real, accessible CTA. Min 44px tap target for
 * mobile, clear hover state, consistent across screens.
 */
export function BackLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 min-h-11 -ml-2.5 px-2.5 rounded-lg text-sm font-medium text-ink-soft hover:text-ink hover:bg-line/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition ${className}`}
    >
      <span aria-hidden className="text-lg leading-none">←</span>
      {children}
    </Link>
  );
}
