import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeMagicLinkToken, createCustomerSession } from "@/lib/customer-auth";
import { applyFirstTouch, recordRelationship } from "@/lib/attribution";
import { consume } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Magic-link landing. Burns the token, opens a customer session, and forwards
 * to wherever they were headed. `next` is constrained to same-origin paths so a
 * crafted link can't bounce a freshly-authenticated customer off-site.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const nextParam = url.searchParams.get("next") ?? "/messages";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/messages";

  // Same bound as the vendor verify route. This one mints a customer session
  // on success, so it is worth keeping cheap to hammer.
  const gate = await consume("tokenVerify", { ip: clientIp(request.headers) });
  if (!gate.allowed) {
    return NextResponse.redirect(new URL("/messages/login?expired=1", url.origin));
  }

  const consumed = await consumeMagicLinkToken(token);
  const customerId = consumed?.customerId ?? null;
  if (!customerId) {
    return NextResponse.redirect(new URL("/messages/login?expired=1", url.origin));
  }

  await createCustomerSession(customerId);
  await prisma.customer
    .update({ where: { id: customerId }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  // Attribute the account to whichever vendor's page they entered through, if
  // they don't already have a first touch.
  await applyFirstTouch(customerId);

  // Apply the follow they opted into when requesting the link. Held on the
  // token rather than the redirect URL so it can't be forged by editing the
  // link — the opt-in happened before the token was issued.
  if (consumed?.followSellerId) {
    await recordRelationship({
      customerId,
      sellerId: consumed.followSellerId,
      source: "signup",
      follow: true,
    });
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
