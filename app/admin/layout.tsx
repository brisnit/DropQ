import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Logo } from "@/components/logo";

export const metadata = { title: "DropQ Admin" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-ink text-cream">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo href="/admin" light />
            <span className="text-xs font-semibold uppercase tracking-wider bg-brand text-white px-2 py-0.5 rounded-pill">
              Admin
            </span>
          </div>
          <Link href="/dashboard" className="text-sm text-cream/70 hover:text-cream">
            My dashboard →
          </Link>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-5 py-8">{children}</main>
    </div>
  );
}
