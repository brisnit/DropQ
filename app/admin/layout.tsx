import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { logoutAction } from "@/lib/actions/auth";

export const metadata = { title: "DropQ Admin" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-ink text-cream">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <Logo href="/admin" light />
            <span className="text-xs font-semibold uppercase tracking-wider bg-brand text-white px-2 py-0.5 rounded-pill">
              Admin
            </span>
          </div>
          <nav className="flex items-center gap-1 text-sm overflow-x-auto">
            <Link href="/admin" className="px-3 py-1.5 rounded-lg text-cream/80 hover:text-cream hover:bg-white/10 whitespace-nowrap">Vendors</Link>
            <Link href="/admin/activation" className="px-3 py-1.5 rounded-lg text-cream/80 hover:text-cream hover:bg-white/10 whitespace-nowrap">Activation</Link>
            <Link href="/admin/sales-reps" className="px-3 py-1.5 rounded-lg text-cream/80 hover:text-cream hover:bg-white/10 whitespace-nowrap">Sales Reps</Link>
            <Link href="/admin/commissions" className="px-3 py-1.5 rounded-lg text-cream/80 hover:text-cream hover:bg-white/10 whitespace-nowrap">Commissions</Link>
          </nav>
          {/* Admin had no way to sign out without going back to the vendor
              dashboard first. */}
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/dashboard" className="text-sm text-cream/70 hover:text-cream whitespace-nowrap">
              My dashboard →
            </Link>
            <form action={logoutAction}>
              <button className="text-sm text-cream/70 hover:text-cream whitespace-nowrap min-h-[40px] px-2">
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
