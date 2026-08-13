import Link from "next/link";
import { Logo } from "@/components/logo";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between bg-ink text-cream p-12 overflow-hidden">
        <div className="absolute inset-0 hero-glow opacity-80" />
        <div className="relative">
          <Logo href="/" light />
        </div>
        <div className="relative max-w-md">
          <p className="font-display text-3xl leading-snug font-medium">
            “We went from a chaotic Instagram DM mess to selling out a 400-cookie
            drop in 9 minutes — without the site crashing.”
          </p>
          <p className="mt-5 text-cream/70">
            Renata K. — Marble &amp; Crumb, Austin TX
          </p>
        </div>
        <div className="relative flex gap-6 text-sm text-cream/60">
          <span>12,000+ food businesses</span>
          <span>·</span>
          <span>$200M+ sold</span>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-col p-6 sm:p-10">
        <div className="lg:hidden mb-10">
          <Logo href="/" />
        </div>
        <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {title}
          </h1>
          <p className="text-muted mt-2 mb-8">{subtitle}</p>
          {children}
        </div>
        <div className="max-w-sm w-full mx-auto pt-8 text-xs text-muted">
          <Link href="/" className="hover:text-ink">
            ← Back to drop-q.com
          </Link>
        </div>
      </div>
    </div>
  );
}
