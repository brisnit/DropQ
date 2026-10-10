import Link from "next/link";
import { resolveBackLink } from "@/lib/browse-origin";

/**
 * The way back into DropQ from a storefront or a drop page.
 *
 * A plain server-rendered link, deliberately:
 *
 *  • It is in the initial HTML, so it is there for the first tap rather than
 *    appearing once JavaScript has hydrated.
 *  • It is an `href`, never `router.back()`. History is not ours — a visitor
 *    who arrived from a text message or Instagram would be sent off DropQ.
 *
 * `min-h-11` gives it a 44px tap target at every width, and it sits in the
 * normal flow at the top of the page rather than floating, so it never lands
 * on top of a vendor's own controls.
 */
export function BackToBrowse({
  searchParams,
  className = "",
}: {
  searchParams: { from?: string | string[]; f?: string | string[] };
  className?: string;
}) {
  const { href, label } = resolveBackLink(searchParams);
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 min-h-11 -ml-1 px-1 text-sm font-medium text-ink-soft hover:text-ink transition ${className}`}
    >
      <span aria-hidden className="text-base leading-none">
        ←
      </span>
      {label}
    </Link>
  );
}
