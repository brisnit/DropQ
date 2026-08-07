import "server-only";
import { prisma } from "@/lib/db";

/**
 * In-app notification reads. Distinct from lib/notifications.ts, which is the
 * outbound *channel* layer (email/SMS). This file only ever touches the
 * Notification table, and every query is scoped by the owner's id so a user
 * can't read or clear notifications that aren't theirs.
 */

export type Viewer = { kind: "vendor"; sellerId: string } | { kind: "customer"; customerId: string };

function scope(v: Viewer) {
  return v.kind === "vendor"
    ? { recipientType: "vendor", sellerId: v.sellerId }
    : { recipientType: "customer", customerId: v.customerId };
}

export async function listNotifications(v: Viewer, limit = 20) {
  return prisma.notification.findMany({
    where: scope(v),
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function unreadNotificationCount(v: Viewer): Promise<number> {
  return prisma.notification.count({ where: { ...scope(v), readAt: null } });
}

/** Mark one notification read. Returns false if it isn't the viewer's. */
export async function markNotificationRead(v: Viewer, notificationId: string): Promise<boolean> {
  const res = await prisma.notification.updateMany({
    where: { id: notificationId, ...scope(v), readAt: null },
    data: { readAt: new Date() },
  });
  return res.count > 0;
}

export async function markAllNotificationsRead(v: Viewer): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { ...scope(v), readAt: null },
    data: { readAt: new Date() },
  });
  return res.count;
}

/** Where a notification should take you when tapped. */
export function notificationHref(
  v: Viewer,
  n: { conversationId: string | null; orderId: string | null }
): string {
  if (n.conversationId) {
    return v.kind === "vendor" ? `/dashboard/messages/${n.conversationId}` : `/messages/${n.conversationId}`;
  }
  if (n.orderId && v.kind === "vendor") return `/dashboard/orders`;
  if (n.orderId) return `/order/${n.orderId}`;
  return v.kind === "vendor" ? "/dashboard/messages" : "/messages";
}
