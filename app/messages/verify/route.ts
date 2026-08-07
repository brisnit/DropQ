import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeMagicLinkToken, createCustomerSession } from "@/lib/customer-auth";

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

  const customerId = await consumeMagicLinkToken(token);
  if (!customerId) {
    return NextResponse.redirect(new URL("/messages/login?expired=1", url.origin));
  }

  await createCustomerSession(customerId);
  await prisma.customer
    .update({ where: { id: customerId }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return NextResponse.redirect(new URL(next, url.origin));
}
