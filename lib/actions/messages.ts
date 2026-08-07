"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSeller } from "@/lib/auth";
import { requireCustomer } from "@/lib/customer-auth";
import {
  getOrCreateConversation,
  customerForOrder,
  sendMessage,
  sendBroadcast,
  markConversationRead,
  isAudience,
  MAX_BODY,
  type Audience,
} from "@/lib/messaging";
import {
  markNotificationRead,
  markAllNotificationsRead,
  type Viewer,
} from "@/lib/notification-center";

/** The created message rides back on success so the thread can swap its
 *  optimistic bubble for the real row without waiting for the next poll. */
export type SentMessage = {
  id: string;
  body: string;
  senderType: "vendor" | "customer" | "system";
  messageType: string;
  createdAt: string;
  readAt: string | null;
};

export type SendState = { ok?: boolean; error?: string; message?: SentMessage };
export type BroadcastState = { ok?: boolean; error?: string; sent?: number };

function serialize(m: {
  id: string;
  body: string;
  senderType: string;
  messageType: string;
  createdAt: Date;
  readAt: Date | null;
}): SentMessage {
  return {
    id: m.id,
    body: m.body,
    senderType: m.senderType as SentMessage["senderType"],
    messageType: m.messageType,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt?.toISOString() ?? null,
  };
}

function bodyOf(formData: FormData): string {
  return String(formData.get("body") ?? "").trim();
}

// ── Vendor ─────────────────────────────────────────────────────────────────

/** Vendor sends into one of their own conversations. */
export async function vendorSendMessageAction(
  _prev: SendState,
  formData: FormData
): Promise<SendState> {
  const seller = await requireSeller();
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = bodyOf(formData);

  if (!body) return { error: "Type a message first." };
  if (body.length > MAX_BODY) return { error: `Keep it under ${MAX_BODY} characters.` };

  // Ownership is the query, not a follow-up check.
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, sellerId: seller.id },
    select: { id: true, lastDropId: true, lastOrderId: true },
  });
  if (!convo) return { error: "Conversation not found." };

  let sent;
  try {
    const res = await sendMessage({
      conversationId: convo.id,
      senderType: "vendor",
      senderSellerId: seller.id,
      body,
      dropId: convo.lastDropId,
      orderId: convo.lastOrderId,
    });
    sent = res.message;
  } catch (e) {
    console.error("vendorSendMessageAction failed:", e);
    return { error: "Couldn't send that message. Please try again." };
  }

  revalidatePath("/dashboard/messages");
  return { ok: true, message: serialize(sent) };
}

/**
 * "Message Customer" from anywhere a vendor sees an order. Opens or reuses the
 * conversation, carries the order + drop context in, and lands the vendor in
 * the thread.
 */
export async function messageCustomerFromOrderAction(formData: FormData): Promise<void> {
  const seller = await requireSeller();
  const orderId = String(formData.get("orderId") ?? "");

  const found = await customerForOrder(orderId, seller.id);
  if (!found) redirect("/dashboard/messages");

  const convo = await getOrCreateConversation(seller.id, found.customer.id, {
    dropId: found.order.dropId,
    orderId: found.order.id,
  });

  revalidatePath("/dashboard/messages");
  redirect(`/dashboard/messages/${convo.id}`);
}

/** Open a conversation from the Customers list (no specific order). */
export async function messageCustomerByEmailAction(formData: FormData): Promise<void> {
  const seller = await requireSeller();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/dashboard/messages");

  // Only reachable for someone who has actually ordered from this vendor.
  const order = await prisma.order.findFirst({
    where: { sellerId: seller.id, buyerEmail: email, status: { not: "pending" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!order) redirect("/dashboard/messages");

  const found = await customerForOrder(order.id, seller.id);
  if (!found) redirect("/dashboard/messages");

  const convo = await getOrCreateConversation(seller.id, found.customer.id, {
    dropId: found.order.dropId,
    orderId: found.order.id,
  });
  redirect(`/dashboard/messages/${convo.id}`);
}

/**
 * Marking read is driven from the client once the thread is actually on screen.
 * Doing it during the page render would let Next's link prefetching silently
 * clear someone's unread badge on hover.
 */
export async function vendorMarkReadAction(conversationId: string): Promise<void> {
  const seller = await requireSeller();
  await markConversationRead(conversationId, "vendor", seller.id);
  revalidatePath("/dashboard/messages");
}

// ── Broadcast ──────────────────────────────────────────────────────────────

export async function sendBroadcastAction(
  _prev: BroadcastState,
  formData: FormData
): Promise<BroadcastState> {
  const seller = await requireSeller();
  const body = bodyOf(formData);
  const audienceRaw = String(formData.get("audience") ?? "");
  const dropId = String(formData.get("dropId") ?? "") || null;
  const selected = formData.getAll("customerIds").map(String).filter(Boolean);

  if (!body) return { error: "Write your announcement first." };
  if (body.length > MAX_BODY) return { error: `Keep it under ${MAX_BODY} characters.` };
  if (!isAudience(audienceRaw)) return { error: "Pick who should receive this." };
  const audience: Audience = audienceRaw;
  if (audience === "selected" && selected.length === 0) {
    return { error: "Select at least one customer." };
  }

  // Confirm the drop belongs to this vendor before it scopes an audience.
  if (dropId) {
    const owned = await prisma.drop.findFirst({
      where: { id: dropId, sellerId: seller.id },
      select: { id: true },
    });
    if (!owned) return { error: "Drop not found." };
  }

  try {
    const { sent } = await sendBroadcast({
      sellerId: seller.id,
      audience,
      dropId,
      body,
      selectedCustomerIds: selected,
    });
    if (sent === 0) return { error: "Nobody matches that audience yet." };

    revalidatePath("/dashboard/messages");
    if (dropId) revalidatePath(`/dashboard/drops/${dropId}`);
    return { ok: true, sent };
  } catch (e) {
    console.error("sendBroadcastAction failed:", e);
    return { error: "Couldn't send that announcement. Please try again." };
  }
}

// ── Customer ───────────────────────────────────────────────────────────────

export async function customerSendMessageAction(
  _prev: SendState,
  formData: FormData
): Promise<SendState> {
  const customer = await requireCustomer();
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = bodyOf(formData);

  if (!body) return { error: "Type a message first." };
  if (body.length > MAX_BODY) return { error: `Keep it under ${MAX_BODY} characters.` };

  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, customerId: customer.id },
    select: { id: true, lastDropId: true, lastOrderId: true },
  });
  if (!convo) return { error: "Conversation not found." };

  let sent;
  try {
    const res = await sendMessage({
      conversationId: convo.id,
      senderType: "customer",
      senderCustomerId: customer.id,
      body,
      dropId: convo.lastDropId,
      orderId: convo.lastOrderId,
    });
    sent = res.message;
  } catch (e) {
    console.error("customerSendMessageAction failed:", e);
    return { error: "Couldn't send that message. Please try again." };
  }

  revalidatePath("/messages");
  return { ok: true, message: serialize(sent) };
}

export async function customerMarkReadAction(conversationId: string): Promise<void> {
  const customer = await requireCustomer();
  await markConversationRead(conversationId, "customer", customer.id);
  revalidatePath("/messages");
}

// ── Notifications ──────────────────────────────────────────────────────────

async function currentViewer(kind: string): Promise<Viewer> {
  if (kind === "vendor") {
    const seller = await requireSeller();
    return { kind: "vendor", sellerId: seller.id };
  }
  const customer = await requireCustomer();
  return { kind: "customer", customerId: customer.id };
}

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const viewer = await currentViewer(String(formData.get("viewer") ?? "vendor"));
  await markNotificationRead(viewer, String(formData.get("notificationId") ?? ""));
  revalidatePath(viewer.kind === "vendor" ? "/dashboard" : "/messages");
}

export async function markAllNotificationsReadAction(formData: FormData): Promise<void> {
  const viewer = await currentViewer(String(formData.get("viewer") ?? "vendor"));
  await markAllNotificationsRead(viewer);
  revalidatePath(viewer.kind === "vendor" ? "/dashboard" : "/messages");
}
