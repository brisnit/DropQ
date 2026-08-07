import "server-only";
import { prisma } from "@/lib/db";
import {
  listNotifications,
  unreadNotificationCount,
  notificationHref,
} from "@/lib/notification-center";

/**
 * Chrome data for the customer shell — notifications and the unread message
 * count. Shared by the /my and /messages layouts so both render identical
 * navigation without duplicating the queries.
 */
export async function loadShellData(customerId: string) {
  const viewer = { kind: "customer", customerId } as const;

  const [notifications, unreadNotifications, messages] = await Promise.all([
    listNotifications(viewer),
    unreadNotificationCount(viewer),
    prisma.conversation.aggregate({ where: { customerId }, _sum: { customerUnread: true } }),
  ]);

  return {
    notifications: notifications.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      href: notificationHref(viewer, n),
      createdAt: n.createdAt.toISOString(),
      read: !!n.readAt,
    })),
    unreadNotifications,
    unreadMessages: messages._sum.customerUnread ?? 0,
  };
}
