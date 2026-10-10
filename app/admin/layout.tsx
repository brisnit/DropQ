import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { logoutAction } from "@/lib/actions/auth";
import { AdminNav } from "@/components/admin-nav";

export const metadata = { title: "DropQ Admin" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-ink text-cream">
        <div className="max-w-6xl mx-auto px-4 sm:px-5 py-2 sm:py-0 sm:h-14 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-3 shrink-0">
            <Logo href="/admin" light />
            <span className="text-xs font-semibold uppercase tracking-wider bg-brand text-white px-2 py-0.5 rounded-pill">
              Admin
            </span>
          </div>
          <AdminNav />
          {/* Admin had no way to sign out without going back to the vendor
              dashboard first. */}
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/dashboard" className="text-sm text-cream/70 hover:text-cream whitespace-nowrap">
              My dashboard →
            </Link>
            <form action={logoutAction}>
              <button className="text-sm text-cream/70 hover:text-cream whitespace-nowrap min-h-11 px-2">
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-5 py-8">{children}</main>
    </div>
  );
}
