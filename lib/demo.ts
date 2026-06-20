// The marketing "See a live store" showcase. It's a visual demo only — hidden
// from the admin Vendors list and not accepting real orders.
export const DEMO_SELLER_EMAIL = "showcase@dropq.example";
export const DEMO_SELLER_SLUG = "marble-crumb";

export function isDemoStore(s: {
  email?: string | null;
  slug?: string | null;
}): boolean {
  return s.email === DEMO_SELLER_EMAIL || s.slug === DEMO_SELLER_SLUG;
}
