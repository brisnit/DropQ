import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { readTouch, resolveTouchVendor } from "@/lib/attribution";
import { CustomerLoginForm } from "@/components/customer-login-form";
import { Logo } from "@/components/logo";
import { Avatar } from "@/components/avatar";

export const metadata = { title: "Sign in — DropQ" };

/**
 * Sign-in.
 *
 * When someone arrived through a vendor, that vendor stays visually in front:
 * their name, logo and the drop they came for. DropQ powers the transaction but
 * doesn't take over the relationship the vendor built — the customer should
 * read this as "I'm signing in to order from *them*".
 *
 * The vendor comes from the first-touch cookie set by middleware, so it works
 * from a QR code, a shared link or an Instagram bio without any query string.
 */
export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string; error?: string }>;
}) {
  const { next, expired, error } = await searchParams;

  const customer = await getCurrentCustomer();
  if (customer) redirect(next && next.startsWith("/") ? next : "/my");

  // Vendor-first framing when we know who sent them.
  const touch = await readTouch();
  const vendor = touch ? await resolveTouchVendor(touch) : null;
  const drop =
    vendor && touch?.dropId
      ? await prisma.drop.findFirst({
          where: { id: touch.dropId, sellerId: vendor.id },
          select: {
            id: true,
            title: true,
            pickupLocationName: true,
            pickupStartAt: true,
            fulfillment: true,
            products: { select: { imageUrl: true }, take: 1 },
          },
        })
      : null;

  const dropImage = drop?.products[0]?.imageUrl ?? null;

  return (
    <main className="min-h-dvh bg-cream">
      <div className="px-5 h-14 flex items-center border-b border-line bg-paper">
        <Logo href="/" />
      </div>

      <div className="p-5 sm:p-8 max-w-md mx-auto">
        {vendor && (
          <div className="bg-paper border border-line rounded-card overflow-hidden mb-5">
            {dropImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dropImage} alt="" className="w-full h-36 object-cover" />
            )}
            <div className="p-5">
              <div className="flex items-center gap-3">
                <Avatar name={vendor.storeName} imageUrl={vendor.logoUrl} size="lg" seed={vendor.id} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Ordering from
                  </p>
                  <p className="font-display text-xl font-semibold truncate">{vendor.storeName}</p>
                </div>
              </div>

              {drop && (
                <div className="mt-4 pt-4 border-t border-line">
                  <p className="font-medium">{drop.title}</p>
                  <p className="text-sm text-muted mt-0.5">
                    {[
                      drop.fulfillment === "delivery" ? "Delivery" : "Pickup",
                      drop.pickupLocationName,
                      drop.pickupStartAt
                        ? drop.pickupStartAt.toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "short",
                            day: "numeric",
                            timeZone: "America/Los_Angeles",
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <CustomerLoginForm
          next={next ?? "/my"}
          expired={expired === "1"}
          oauthError={
            error === "unverified_email"
              ? "That Google account's email isn't verified, so we can't use it to sign in. Use the email link below instead."
              : error === "no_email"
                ? "That account didn't share an email address. Use the email link below instead."
                : null
          }
          vendorName={vendor?.storeName ?? null}
        />

        {vendor && (
          <p className="text-xs text-muted text-center mt-4">
            {vendor.storeName} sells on DropQ. Your account works across every vendor you order
            from.
          </p>
        )}
      </div>
    </main>
  );
}
