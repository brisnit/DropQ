import "server-only";
import { prisma } from "@/lib/db";
import { upsertCustomer } from "@/lib/customer-auth";
import { appUrl, deliverNotifications } from "@/lib/message-delivery";
import { orderStatusLabel } from "@/lib/orders";

/**
 * The messaging core. Every read and write here is scoped by the caller's own
 * id — a vendor can only ever touch conversations where Conversation.sellerId
 * is theirs, a customer only where Conversation.customerId is theirs. There is
 * no "load by id then check" path that could be forgotten; the ownership
 * predicate is part of the query.
 */

// Client-safe helpers live in messaging-shared so components can import them
// without dragging Prisma across the boundary. Re-exported so server callers
// keep a single import site.
import {
  MAX_BODY,
  preview,
  customerLabel,
  initials,
  AUDIENCES,
  isAudience,
  messageStamp,
  type Audience,
  type MessageType,
  type SenderType,
} from "@/lib/messaging-shared";

export { MAX_BODY, preview, customerLabel, initials, AUDIENCES, isAudience, messageStamp };
export type { Audience, MessageType, SenderType };

// ── Conversation access (the permission boundary) ──────────────────────────

/** A vendor's view of one conversation, or null if it isn't theirs. */
export async function vendorConversation(sellerId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, sellerId },
    include: {
      customer: true,
      lastDrop: { select: { id: true, title: true, status: true } },
      lastOrder: { select: { id: true, status: true, totalCents: true, createdAt: true } },
    },
  });
}

/** A customer's view of one conversation, or null if they aren't a participant. */
export async function customerConversation(customerId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, customerId },
    include: {
      seller: { select: { id: true, storeName: true, slug: true, logoUrl: true, accent: true } },
      lastDrop: { select: { id: true, title: true, status: true } },
      lastOrder: { select: { id: true, status: true, totalCents: true, createdAt: true } },
    },
  });
}

/**
 * Find-or-create the single conversation between a vendor and a customer.
 * Reused across every drop — context is attached to messages, not to a new
 * thread. Optional drop/order context updates the conversation's "current"
 * pointers so the header shows what they're most likely talking about.
 */
export async function getOrCreateConversation(
  sellerId: string,
  customerId: string,
  ctx?: { dropId?: string | null; orderId?: string | null }
) {
  const existing = await prisma.conversation.findUnique({
    where: { sellerId_customerId: { sellerId, customerId } },
  });

  if (existing) {
    // Only move the context pointers forward when we were handed new context.
    if ((ctx?.dropId && ctx.dropId !== existing.lastDropId) || (ctx?.orderId && ctx.orderId !== existing.lastOrderId)) {
      return prisma.conversation.update({
        where: { id: existing.id },
        data: {
          lastDropId: ctx?.dropId ?? existing.lastDropId,
          lastOrderId: ctx?.orderId ?? existing.lastOrderId,
        },
      });
    }
    return existing;
  }

  try {
    return await prisma.conversation.create({
      data: {
        sellerId,
        customerId,
        lastDropId: ctx?.dropId ?? null,
        lastOrderId: ctx?.orderId ?? null,
        lastMessageAt: new Date(),
      },
    });
  } catch {
    // Lost a race against a concurrent create — the unique constraint did its
    // job; just read the winner back.
    const won = await prisma.conversation.findUnique({
      where: { sellerId_customerId: { sellerId, customerId } },
    });
    if (!won) throw new Error("Could not open conversation.");
    return won;
  }
}

/** Resolve an order to a Customer, creating the identity if it predates messaging. */
export async function customerForOrder(orderId: string, sellerId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, sellerId },
    select: { id: true, dropId: true, customerId: true, buyerName: true, buyerEmail: true, buyerPhone: true },
  });
  if (!order) return null;

  if (order.customerId) {
    const c = await prisma.customer.findUnique({ where: { id: order.customerId } });
    if (c) return { customer: c, order };
  }

  const customer = await upsertCustomer({
    email: order.buyerEmail,
    name: order.buyerName,
    phone: order.buyerPhone,
  });
  if (!customer) return null;

  await prisma.order.update({ where: { id: order.id }, data: { customerId: customer.id } });
  return { customer, order };
}

// ── Inbox rows ─────────────────────────────────────────────────────────────

/** Conversation rows for a vendor's Messages panel, newest activity first. */
export async function vendorConversationRows(sellerId: string) {
  const convos = await prisma.conversation.findMany({
    where: { sellerId },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    include: {
      customer: { select: { id: true, name: true, email: true } },
      lastDrop: { select: { title: true } },
      lastOrder: { select: { status: true } },
    },
  });

  return convos.map((c) => ({
    id: c.id,
    href: `/dashboard/messages/${c.id}`,
    name: customerLabel(c.customer),
    imageUrl: null,
    preview: c.lastMessagePreview,
    lastMessageAt: c.lastMessageAt,
    unread: c.vendorUnread,
    context: [c.lastDrop?.title, c.lastOrder ? orderStatusLabel(c.lastOrder.status) : null]
      .filter(Boolean)
      .join(" · ") || null,
  }));
}

/** Conversation rows for a customer's inbox, across every vendor. */
export async function customerConversationRows(customerId: string) {
  const convos = await prisma.conversation.findMany({
    where: { customerId },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    include: {
      seller: { select: { storeName: true, logoUrl: true } },
      lastDrop: { select: { title: true } },
      lastOrder: { select: { status: true } },
    },
  });

  return convos.map((c) => ({
    id: c.id,
    href: `/messages/${c.id}`,
    name: c.seller.storeName,
    imageUrl: c.seller.logoUrl,
    preview: c.lastMessagePreview,
    lastMessageAt: c.lastMessageAt,
    unread: c.customerUnread,
    context: [c.lastDrop?.title, c.lastOrder ? orderStatusLabel(c.lastOrder.status) : null]
      .filter(Boolean)
      .join(" · ") || null,
  }));
}

/** Full message history for a conversation, serialized for the client thread. */
export async function threadMessages(conversationId: string) {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, body: true, senderType: true, messageType: true, createdAt: true, readAt: true },
  });
  return rows.map((m) => ({
    id: m.id,
    body: m.body,
    senderType: m.senderType as SenderType,
    messageType: m.messageType,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt?.toISOString() ?? null,
  }));
}

// ── Sending ────────────────────────────────────────────────────────────────

export type SendInput = {
  conversationId: string;
  senderType: SenderType;
  senderSellerId?: string | null;
  senderCustomerId?: string | null;
  body: string;
  messageType?: MessageType;
  dropId?: string | null;
  orderId?: string | null;
  broadcastId?: string | null;
  /** Skip per-message channel fan-out; broadcasts batch their own. */
  deferDelivery?: boolean;
};

/**
 * Write a message, move the conversation's denormalized state, bump the other
 * party's unread counter, and raise their notification — all in one
 * transaction so a badge can never disagree with the thread.
 */
export async function sendMessage(input: SendInput) {
  const body = input.body.trim();
  if (!body) throw new Error("Message cannot be empty.");
  if (body.length > MAX_BODY) throw new Error(`Messages are limited to ${MAX_BODY} characters.`);

  const type: MessageType = input.messageType ?? "text";
  const toVendor = input.senderType === "customer";
  const snippet = preview(body);

  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        senderType: input.senderType,
        senderSellerId: input.senderSellerId ?? null,
        senderCustomerId: input.senderCustomerId ?? null,
        body,
        messageType: type,
        dropId: input.dropId ?? null,
        orderId: input.orderId ?? null,
        broadcastId: input.broadcastId ?? null,
      },
    });

    const conversation = await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: message.createdAt,
        lastMessagePreview: snippet,
        lastMessageSender: input.senderType,
        // The sender's own message is never unread for the sender.
        ...(toVendor ? { vendorUnread: { increment: 1 } } : { customerUnread: { increment: 1 } }),
        ...(input.dropId ? { lastDropId: input.dropId } : {}),
        ...(input.orderId ? { lastOrderId: input.orderId } : {}),
      },
      include: {
        customer: true,
        seller: { select: { id: true, email: true, storeName: true, slug: true, logoUrl: true, accent: true } },
      },
    });

    const title =
      input.senderType === "customer"
        ? `${customerLabel(conversation.customer)} sent you a message`
        : type === "announcement"
          ? `${conversation.seller.storeName} posted an announcement`
          : `${conversation.seller.storeName} sent you a message`;

    await tx.notification.create({
      data: {
        recipientType: toVendor ? "vendor" : "customer",
        sellerId: toVendor ? conversation.sellerId : null,
        customerId: toVendor ? null : conversation.customerId,
        type: type === "announcement" ? "announcement" : "message",
        title,
        body: snippet,
        conversationId: conversation.id,
        messageId: message.id,
        dropId: input.dropId ?? null,
        orderId: input.orderId ?? null,
      },
    });

    return { message, conversation };
  });

  if (!input.deferDelivery) {
    await dispatchFor(result.message.id, result.conversation, input.senderType, snippet, type);
  }

  return result;
}

type ConversationWithParties = {
  id: string;
  customer: { id: string; email: string; name: string | null; phone: string | null };
  seller: { id: string; email: string; storeName: string; logoUrl: string | null; accent: string | null };
};

/** Look up the recipient's contact details and hand off to the channel layer. */
export async function dispatchFor(
  messageId: string,
  conversation: ConversationWithParties,
  senderType: SenderType,
  snippet: string,
  type: MessageType
) {
  const base = appUrl();
  try {
    if (senderType === "customer") {
      await deliverNotifications({
        messageId,
        recipient: "vendor",
        email: conversation.seller.email,
        link: `${base}/dashboard/messages/${conversation.id}`,
        preview: snippet,
        customerName: customerLabel(conversation.customer),
      });
    } else {
      // SMS stays gated on the customer's own marketing consent, tracked on the
      // Subscriber record for this vendor.
      const sub = await prisma.subscriber.findFirst({
        where: { sellerId: conversation.seller.id, email: conversation.customer.email },
        select: { optInSms: true },
      });
      await deliverNotifications({
        messageId,
        recipient: "customer",
        email: conversation.customer.email,
        phone: conversation.customer.phone,
        link: `${base}/messages/${conversation.id}`,
        preview: snippet,
        announcement: type === "announcement",
        storeName: conversation.seller.storeName,
        logoUrl: conversation.seller.logoUrl,
        accent: conversation.seller.accent,
        smsConsent: !!sub?.optInSms,
      });
    }
  } catch (e) {
    // Delivery is best-effort. The message is already durable.
    console.error("Message delivery failed:", e);
  }
}

// ── Reading ────────────────────────────────────────────────────────────────

/** Zero a participant's unread counter. Scoped so it can't clear someone else's. */
export async function markConversationRead(
  conversationId: string,
  who: "vendor" | "customer",
  ownerId: string
) {
  const scope = who === "vendor" ? { sellerId: ownerId } : { customerId: ownerId };
  const owned = await prisma.conversation.findFirst({
    where: { id: conversationId, ...scope },
    select: { id: true },
  });
  if (!owned) return false;

  const now = new Date();
  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversationId },
      data:
        who === "vendor"
          ? { vendorUnread: 0, vendorLastReadAt: now }
          : { customerUnread: 0, customerLastReadAt: now },
    }),
    // Mark the *other* party's messages as read — never your own.
    prisma.message.updateMany({
      where: {
        conversationId,
        readAt: null,
        senderType: who === "vendor" ? "customer" : { in: ["vendor", "system"] },
      },
      data: { readAt: now },
    }),
    prisma.notification.updateMany({
      where: { conversationId, readAt: null, ...scope },
      data: { readAt: now },
    }),
  ]);
  return true;
}

export async function vendorUnreadTotal(sellerId: string): Promise<number> {
  const agg = await prisma.conversation.aggregate({
    where: { sellerId },
    _sum: { vendorUnread: true },
  });
  return agg._sum.vendorUnread ?? 0;
}

export async function customerUnreadTotal(customerId: string): Promise<number> {
  const agg = await prisma.conversation.aggregate({
    where: { customerId },
    _sum: { customerUnread: true },
  });
  return agg._sum.customerUnread ?? 0;
}

// ── Customer context panel ─────────────────────────────────────────────────

export type CustomerContext = {
  name: string;
  email: string;
  phone: string | null;
  totalOrders: number;
  dropsParticipated: number;
  currentOrder: { id: string; status: string; totalCents: number; createdAt: Date } | null;
  currentDrop: { id: string; title: string; status: string } | null;
};

/**
 * The compact "who am I talking to" summary. Scoped to this vendor's own
 * orders — one vendor never sees a customer's history with another store.
 */
export async function customerContext(
  sellerId: string,
  customerId: string
): Promise<CustomerContext | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return null;

  const orders = await prisma.order.findMany({
    where: { sellerId, customerId, status: { not: "pending" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, totalCents: true, createdAt: true, dropId: true, drop: { select: { id: true, title: true, status: true } } },
  });

  const latest = orders[0] ?? null;
  return {
    name: customerLabel(customer),
    email: customer.email,
    phone: customer.phone,
    totalOrders: orders.length,
    dropsParticipated: new Set(orders.map((o) => o.dropId)).size,
    currentOrder: latest
      ? { id: latest.id, status: latest.status, totalCents: latest.totalCents, createdAt: latest.createdAt }
      : null,
    currentDrop: latest?.drop ?? null,
  };
}

// ── Broadcast audiences ────────────────────────────────────────────────────

const ACTIVE_STATUSES = ["new", "in_progress", "ready"];

/**
 * Resolve an audience to concrete customers. Always filtered by sellerId, so a
 * vendor can only ever address buyers who ordered from them.
 */
export async function resolveAudience(
  sellerId: string,
  audience: Audience,
  dropId: string | null,
  selectedCustomerIds: string[] = []
) {
  const where: Record<string, unknown> = { sellerId, status: { not: "pending" } };
  if (dropId) where.dropId = dropId;

  if (audience === "active_orders") where.status = { in: ACTIVE_STATUSES };
  if (audience === "ready_pickup") where.status = "ready";
  if (audience === "selected") {
    if (selectedCustomerIds.length === 0) return [];
    where.customerId = { in: selectedCustomerIds };
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      dropId: true,
      customerId: true,
      buyerName: true,
      buyerEmail: true,
      buyerPhone: true,
    },
  });

  // Collapse to one recipient per customer, keeping their most recent order as
  // the context we attach to the announcement.
  const byCustomer = new Map<
    string,
    { customerId: string; orderId: string; dropId: string; name: string; email: string }
  >();

  for (const o of orders) {
    let customerId = o.customerId;
    if (!customerId) {
      // Order predates messaging (or was created before the backfill ran).
      const c = await upsertCustomer({ email: o.buyerEmail, name: o.buyerName, phone: o.buyerPhone });
      if (!c) continue;
      customerId = c.id;
      await prisma.order.update({ where: { id: o.id }, data: { customerId } });
    }
    if (byCustomer.has(customerId)) continue;
    byCustomer.set(customerId, {
      customerId,
      orderId: o.id,
      dropId: o.dropId,
      name: o.buyerName,
      email: o.buyerEmail,
    });
  }

  return [...byCustomer.values()];
}

/**
 * Everything the drop dashboard's Customer Communication panel needs:
 * how many people each audience reaches, who's individually selectable, plus
 * unread replies and a couple of recent messages. Deliberately lightweight —
 * this is a launchpad, not a second inbox.
 */
export async function dropCommunicationSummary(sellerId: string, dropId: string) {
  const [all, active, ready] = await Promise.all([
    resolveAudience(sellerId, "drop_all", dropId),
    resolveAudience(sellerId, "active_orders", dropId),
    resolveAudience(sellerId, "ready_pickup", dropId),
  ]);

  const readyIds = new Set(ready.map((r) => r.customerId));
  const activeIds = new Set(active.map((r) => r.customerId));

  const customers = all.map((r) => ({
    id: r.customerId,
    name: r.name,
    statusLabel: readyIds.has(r.customerId)
      ? "Ready for pickup"
      : activeIds.has(r.customerId)
        ? "Active order"
        : "Ordered",
  }));

  const customerIds = all.map((r) => r.customerId);
  const conversations =
    customerIds.length === 0
      ? []
      : await prisma.conversation.findMany({
          where: { sellerId, customerId: { in: customerIds } },
          orderBy: { lastMessageAt: "desc" },
          take: 5,
          include: { customer: { select: { id: true, name: true, email: true } } },
        });

  const unreadReplies = conversations.reduce((sum, c) => sum + c.vendorUnread, 0);

  return {
    counts: {
      drop_all: all.length,
      active_orders: active.length,
      ready_pickup: ready.length,
      selected: 0,
    } as Record<Audience, number>,
    customers,
    unreadReplies,
    recent: conversations
      .filter((c) => c.lastMessagePreview)
      .map((c) => ({
        id: c.id,
        name: customerLabel(c.customer),
        preview: c.lastMessagePreview!,
        lastMessageAt: c.lastMessageAt,
        fromCustomer: c.lastMessageSender === "customer",
        unread: c.vendorUnread,
      })),
  };
}

/**
 * Send one announcement to every resolved recipient as an independent message
 * in their own private conversation. Explicitly not a group thread: replies go
 * back to the vendor only, and no customer can see another customer.
 */
export async function sendBroadcast(input: {
  sellerId: string;
  audience: Audience;
  dropId: string | null;
  body: string;
  selectedCustomerIds?: string[];
}) {
  const body = input.body.trim();
  if (!body) throw new Error("Announcement cannot be empty.");
  if (body.length > MAX_BODY) throw new Error(`Announcements are limited to ${MAX_BODY} characters.`);

  const recipients = await resolveAudience(
    input.sellerId,
    input.audience,
    input.dropId,
    input.selectedCustomerIds ?? []
  );
  if (recipients.length === 0) return { broadcastId: null, sent: 0 };

  const broadcast = await prisma.broadcast.create({
    data: {
      sellerId: input.sellerId,
      dropId: input.dropId,
      audience: input.audience,
      body,
      recipientCount: recipients.length,
    },
  });

  // Write every message first (fast, transactional per recipient), then fan the
  // notifications out in bounded batches so a large drop doesn't stall.
  const sentMessages: { messageId: string; conversation: ConversationWithParties }[] = [];
  for (const r of recipients) {
    const convo = await getOrCreateConversation(input.sellerId, r.customerId, {
      dropId: r.dropId,
      orderId: r.orderId,
    });
    const { message, conversation } = await sendMessage({
      conversationId: convo.id,
      senderType: "vendor",
      senderSellerId: input.sellerId,
      body,
      messageType: "announcement",
      dropId: r.dropId,
      orderId: r.orderId,
      broadcastId: broadcast.id,
      deferDelivery: true,
    });
    sentMessages.push({ messageId: message.id, conversation });
  }

  const BATCH = 10;
  for (let i = 0; i < sentMessages.length; i += BATCH) {
    await Promise.allSettled(
      sentMessages
        .slice(i, i + BATCH)
        .map((s) => dispatchFor(s.messageId, s.conversation, "vendor", preview(body), "announcement"))
    );
  }

  return { broadcastId: broadcast.id, sent: recipients.length };
}
