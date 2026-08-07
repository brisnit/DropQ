import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSeller } from "@/lib/auth";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { vendorUnreadTotal, customerUnreadTotal } from "@/lib/messaging";
import { unreadNotificationCount } from "@/lib/notification-center";

/**
 * Polling endpoint behind the live message/badge updates. DropQ has no realtime
 * transport (no Supabase/Pusher/WebSocket layer anywhere in the stack), so the
 * cleanest option is a small dynamic GET the client hits on an interval — and
 * only while the tab is visible.
 *
 * The viewer is resolved from whichever session cookie is present. Nothing is
 * taken from the query string except *which* conversation to read, and that is
 * still filtered by the viewer's own id, so a guessed conversationId returns
 * 404 rather than someone else's thread.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");
  const afterRaw = url.searchParams.get("after");

  // A vendor testing their own storefront can hold both cookies at once, so the
  // caller says which hat it's wearing. The hint only *chooses between* sessions
  // this browser already proved it has — it never grants access.
  const want = url.searchParams.get("viewer");
  const [sellerSession, customerSession] = await Promise.all([
    getCurrentSeller(),
    getCurrentCustomer(),
  ]);

  const seller = want === "customer" ? null : sellerSession;
  const customer = seller ? null : customerSession;

  if (!seller && !customer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const viewer = seller
    ? ({ kind: "vendor", sellerId: seller.id } as const)
    : ({ kind: "customer", customerId: customer!.id } as const);

  const [unreadTotal, notifications] = await Promise.all([
    seller ? vendorUnreadTotal(seller.id) : customerUnreadTotal(customer!.id),
    unreadNotificationCount(viewer),
  ]);

  if (!conversationId) {
    return NextResponse.json({ unreadTotal, notifications });
  }

  // Ownership is part of the lookup — never a separate check.
  const owned = await prisma.conversation.findFirst({
    where: seller
      ? { id: conversationId, sellerId: seller.id }
      : { id: conversationId, customerId: customer!.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const after = afterRaw ? new Date(afterRaw) : null;
  const messages = await prisma.message.findMany({
    where: {
      conversationId: owned.id,
      ...(after && !Number.isNaN(after.getTime()) ? { createdAt: { gt: after } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      body: true,
      senderType: true,
      messageType: true,
      createdAt: true,
      readAt: true,
    },
  });

  return NextResponse.json({ unreadTotal, notifications, messages });
}
