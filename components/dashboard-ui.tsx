import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle && <p className="text-muted mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-paper border border-line rounded-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="font-display text-3xl font-semibold mt-1.5">{value}</p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </div>
  );
}

export function EmptyState({
  emoji,
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  emoji: string;
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="bg-paper border border-dashed border-line-strong rounded-card p-12 text-center">
      <div className="text-5xl">{emoji}</div>
      <h3 className="font-display text-xl font-semibold mt-4">{title}</h3>
      <p className="text-muted mt-2 max-w-sm mx-auto">{body}</p>
      {ctaHref && ctaLabel && (
        <div className="mt-6">
          <LinkButton href={ctaHref}>{ctaLabel}</LinkButton>
        </div>
      )}
    </div>
  );
}

export function Section({ children }: { children: ReactNode }) {
  return <div className="p-5 sm:p-8 max-w-5xl">{children}</div>;
}
