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

/**
 * An empty state should answer three questions: what is this, why would I use
 * it, and what do I do next. `title` is the invitation, `body` is the why, the
 * CTA is the next step, and `note` carries the one extra fact a beginner needs
 * without turning the card into documentation.
 */
export function EmptyState({
  emoji,
  title,
  body,
  ctaHref,
  ctaLabel,
  note,
  secondaryHref,
  secondaryLabel,
}: {
  emoji: string;
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
  /** One short clarifying fact, shown under the CTA. */
  note?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="bg-paper border border-dashed border-line-strong rounded-card p-10 sm:p-12 text-center">
      <div className="text-5xl">{emoji}</div>
      <h3 className="font-display text-xl font-semibold mt-4">{title}</h3>
      <p className="text-muted mt-2 max-w-md mx-auto">{body}</p>
      {(ctaHref && ctaLabel) || (secondaryHref && secondaryLabel) ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {ctaHref && ctaLabel && <LinkButton href={ctaHref}>{ctaLabel}</LinkButton>}
          {secondaryHref && secondaryLabel && (
            <LinkButton href={secondaryHref} variant="secondary">
              {secondaryLabel}
            </LinkButton>
          )}
        </div>
      ) : null}
      {note && <p className="text-xs text-muted mt-4 max-w-sm mx-auto">{note}</p>}
    </div>
  );
}

export function Section({ children }: { children: ReactNode }) {
  return <div className="p-5 sm:p-8 max-w-5xl">{children}</div>;
}
