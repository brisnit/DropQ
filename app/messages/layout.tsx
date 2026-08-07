import { getCurrentCustomer } from "@/lib/customer-auth";
import { customerLogoutAction } from "@/lib/actions/customer-auth";
import { markAllNotificationsReadAction } from "@/lib/actions/messages";
import {
  listNotifications,
  unreadNotificationCount,
  notificationHref,
} from "@/lib/notification-center";
import { NotificationBell } from "@/components/notification-bell";
import { Logo } from "@/components/logo";

/**
 * Shell for the customer messaging area. The login and verify routes live under
 * /messages too, so this renders a bare frame when there's no session rather
 * than redirecting — the child pages decide who has to sign in.
 */
export default async function CustomerMessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const customer = await getCurrentCustomer();

  if (!customer) return <>{children}</>;

  const viewer = { kind: "customer", customerId: customer.id } as const;
  const [notifications, unread] = await Promise.all([
    listNotifications(viewer),
    unreadNotificationCount(viewer),
  ]);

  const items = notifications.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    href: notificationHref(viewer, n),
    createdAt: n.createdAt.toISOString(),
    read: !!n.readAt,
  }));

  return (
    <div className="min-h-dvh bg-cream flex flex-col">
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-line shrink-0">
        <div className="flex items-center justify-between px-4 sm:px-5 h-14">
          <Logo href="/" />
          <div className="flex items-center gap-1">
            <NotificationBell
              viewer="customer"
              initialItems={items}
              initialUnread={unread}
              markAllAction={markAllNotificationsReadAction}
            />
            <form action={customerLogoutAction}>
              <button className="min-h-[40px] px-3 rounded-xl text-sm font-medium text-ink-soft hover:bg-line/60 transition">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}
