/**
 * The public site's navigation links.
 *
 * Lives in its own module because two components need it and they live on
 * opposite sides of the server/client boundary: SiteNav renders them for
 * desktop on the server, and SiteNavMobile renders the same list in a menu on
 * the client. One list, so the phone can never quietly offer a different site
 * than the desktop does.
 */
export type SiteLink = {
  href: string;
  label: string;
  /** One line of context, shown in the mobile menu where there is room for it. */
  hint: string;
};

export const SITE_LINKS: readonly SiteLink[] = [
  { href: "/dropmeet", label: "DropMeet", hint: "Markets and pop-ups near you" },
  { href: "/discover", label: "Find Drops", hint: "What's on sale right now" },
  { href: "/#how", label: "How It Works", hint: "Three steps, start to sold" },
  { href: "/#features", label: "Features", hint: "Everything in the box" },
  { href: "/pricing", label: "Pricing", hint: "Free to start" },
];
