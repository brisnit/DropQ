import { requireCustomer } from "@/lib/customer-auth";
import { loadShellData } from "@/lib/my-shell";
import { MyShell } from "@/components/my/shell";

export const dynamic = "force-dynamic";

export default async function MyLayout({ children }: { children: React.ReactNode }) {
  const customer = await requireCustomer("/my");
  const shell = await loadShellData(customer.id);

  return (
    <MyShell
      notifications={shell.notifications}
      unreadNotifications={shell.unreadNotifications}
      unreadMessages={shell.unreadMessages}
    >
      {children}
    </MyShell>
  );
}
