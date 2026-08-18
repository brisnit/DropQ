import Link from "next/link";
import { Logo } from "@/components/logo";
import { NotificationBell, type NotificationItem } from "@/components/notification-bell";
import { MyNav } from "@/components/my/nav";
import { customerLogoutAction } from "@/lib/actions/customer-auth";
import { markAllNotificationsReadAction } from "@/lib/actions/messages";

/**
 * The customer chrome. One shell for My DropQ *and* Messages, so a customer
 * never crosses a visible boundary between "my account" and "my conversations"
 * — they're the same product.
 *
 * `fullBleed` lets a page own its own scrolling (the message thread), rather
 * than sitting in the padded container everything else uses.
 */
export function MyShell({
  children,
  notifications,
  unreadNotifications,
  unreadMessages,
  fullBleed = false,
}: {
  children: React.ReactNode;
  notifications: NotificationItem[];
  unreadNotifications: number;
  unreadMessages: number;
  fullBleed?: boolean;
}) {
  return (
    <div className="min-h-dvh bg-cream flex flex-col">
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-line shrink-0">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 h-14">
          <Logo href="/my" />
          <div className="flex items-center gap-1">
            <NotificationBell
              viewer="customer"
              initialItems={notifications}
              initialUnread={unreadNotifications}
              markAllAction={markAllNotificationsReadAction}
            />
            <form action={customerLogoutAction}>
              <button className="min-h-11 px-3 rounded-xl text-sm font-medium text-ink-soft hover:bg-line/60 transition">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <MyNav unreadMessages={unreadMessages} />
      </header>

      <div className={fullBleed ? "flex-1 min-h-0 flex flex-col" : "flex-1"}>
        {fullBleed ? children : <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto">{children}</div>}
      </div>

      {!fullBleed && (
        <footer className="px-4 sm:px-6 py-8 max-w-5xl mx-auto w-full">
          <p className="text-xs text-muted">
            Powered by{" "}
            <Link href="/" className="hover:underline">
              DropQ
            </Link>
          </p>
        </footer>
      )}
    </div>
  );
}
