export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function dollarsToCents(input: string | number): number {
  const n = typeof input === "number" ? input : parseFloat(input);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-line text-ink-soft",
  live: "bg-sage-tint text-sage",
  closed: "bg-brand-tint text-brand-dark",
  pending: "bg-line text-muted",
  new: "bg-grey-tint text-[#3f434b]",
  in_progress: "bg-quad/15 text-tertiary",
  ready: "bg-sage-tint text-sage",
  completed: "bg-line text-muted",
  fulfilled: "bg-line text-muted",
  canceled: "bg-brand-tint text-brand-dark",
};

export function statusStyle(status: string): string {
  return STATUS_STYLES[status] ?? "bg-line text-ink-soft";
}
