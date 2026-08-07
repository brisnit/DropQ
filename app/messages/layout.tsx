import { getCurrentCustomer } from "@/lib/customer-auth";
import { loadShellData } from "@/lib/my-shell";
import { MyShell } from "@/components/my/shell";

export const dynamic = "force-dynamic";

/**
 * Messages sits inside the My DropQ shell — same header, same nav — so a
 * customer never crosses a visible boundary between their account and their
 * conversations.
 *
 * Signed-out visitors get a bare frame rather than a redirect: the login and
 * verify routes live under /messages too, and they can't render navigation for
 * an account that doesn't exist yet.
 */
export default async function CustomerMessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const customer = await getCurrentCustomer();
  if (!customer) return <>{children}</>;

  const shell = await loadShellData(customer.id);

  return (
    <MyShell
      notifications={shell.notifications}
      unreadNotifications={shell.unreadNotifications}
      unreadMessages={shell.unreadMessages}
      fullBleed
    >
      {children}
    </MyShell>
  );
}
