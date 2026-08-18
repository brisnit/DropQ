import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui";
import { Stat } from "@/components/dashboard-ui";
import {
  loadVendorActivationRows,
  attentionRank,
  type VendorActivationRow,
  type StripeActivationState,
} from "@/lib/activation";

export const metadata = { title: "Vendor activation — DropQ Admin" };

/**
 * Vendor activation operations.
 *
 * Answers one question: **who needs my help getting activated right now?**
 * Not a CRM, not analytics — a work queue.
 *
 * Every state comes from lib/activation.ts, the same derivation the vendor's
 * own dashboard uses. There is deliberately no admin-only Stripe or readiness
 * vocabulary: if an admin sees "needs help", the vendor is seeing the matching
 * "Get ready to sell" card at that same moment.
 */

const STRIPE_LABEL: Record<StripeActivationState, string> = {
  not_started: "Not started",
  incomplete: "Setup incomplete",
  unknown: "Setup incomplete",
  restricted: "Restricted",
  charge_ready: "Charge-ready",
  suspended: "Suspended",
};

const STRIPE_STYLE: Record<StripeActivationState, string> = {
  not_started: "bg-line text-ink-soft",
  incomplete: "bg-quad/15 text-tertiary",
  unknown: "bg-quad/15 text-tertiary",
  restricted: "bg-brand-tint text-brand-dark",
  charge_ready: "bg-sage-tint text-sage",
  suspended: "bg-brand-tint text-brand-dark",
};

function VendorRow({ r }: { r: VendorActivationRow }) {
  const { state, facts } = r;
  const activity = [
    `${r.totalDrops} drop${r.totalDrops === 1 ? "" : "s"}`,
    r.draftDrops > 0 ? `${r.draftDrops} draft` : null,
    facts.liveDrops > 0 ? `${facts.liveDrops} live` : null,
    state.milestones.find((m) => m.key === "publish")!.done ? "published" : "never published",
    `${facts.paidOrders} paid order${facts.paidOrders === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <div className="border-t border-line first:border-t-0 py-3.5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/admin/${r.id}`} className="font-medium hover:underline truncate">
            {r.storeName}
          </Link>
          <Badge className={STRIPE_STYLE[state.stripe]}>{STRIPE_LABEL[state.stripe]}</Badge>
          <span className="text-xs text-muted tabular-nums">
            {state.completed}/{state.total}
          </span>
          {r.isAdmin && <Badge className="bg-ink text-cream">internal</Badge>}
          {!state.applicable && <Badge className="bg-line text-ink-soft">demo</Badge>}
        </div>
        <p className="text-xs text-muted mt-1">
          joined {formatDate(r.createdAt)} · {activity.join(" · ")}
          {r.stripeChargesEnabledAt
            ? ` · charge-ready since ${formatDate(r.stripeChargesEnabledAt)}`
            : ""}
        </p>
        {state.nextAction && (
          <p className="text-xs text-ink-soft mt-1 italic">
            Vendor is being told: “{state.nextAction.reason}”
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/admin/${r.id}`}
          className="text-sm font-medium px-3 py-1.5 rounded-lg border border-line-strong hover:border-ink/30 transition"
        >
          View
        </Link>
        <a
          href={`mailto:${r.email}?subject=${encodeURIComponent(
            "Getting your DropQ store ready to sell"
          )}`}
          className="text-sm font-medium px-3 py-1.5 rounded-lg bg-ink text-cream hover:bg-ink-soft transition"
        >
          Email vendor
        </a>
      </div>
    </div>
  );
}

function Group({
  title,
  hint,
  rows,
  tone,
}: {
  title: string;
  hint: string;
  rows: VendorActivationRow[];
  tone: string;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-7">
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className={`font-semibold ${tone}`}>{title}</h2>
        <span className="text-sm text-muted">
          {rows.length} vendor{rows.length === 1 ? "" : "s"} · {hint}
        </span>
      </div>
      <div className="bg-paper border border-line rounded-card px-4 sm:px-5">
        {rows.map((r) => (
          <VendorRow key={r.id} r={r} />
        ))}
      </div>
    </section>
  );
}

export default async function AdminActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ internal?: string }>;
}) {
  await requireAdmin();
  const { internal } = await searchParams;
  const showInternal = internal === "1";

  const all = await loadVendorActivationRows();

  // Demo stores are excluded outright. Internal accounts are excluded by
  // default but reachable via the toggle — `isAdmin` means "has admin access",
  // not "is internal", so a real vendor granted admin must never silently
  // disappear from the outreach queue.
  const visible = all.filter(
    (r) => r.state.applicable && (showInternal || !r.isAdmin)
  );
  const counted = all.filter((r) => r.outreachable);

  const by = (a: VendorActivationRow["attention"]) =>
    visible
      .filter((r) => r.attention === a)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());

  const paused = by("selling_paused");
  const needsHelp = by("needs_help");
  const rest = visible
    .filter((r) => r.attention === "none")
    .sort(
      (x, y) =>
        attentionRank(x.attention) - attentionRank(y.attention) ||
        y.createdAt.getTime() - x.createdAt.getTime()
    );

  const nPaused = counted.filter((r) => r.attention === "selling_paused").length;
  const nNeedsHelp = counted.filter((r) => r.attention === "needs_help").length;
  const nReady = counted.filter((r) => r.state.readyToSell).length;
  const hiddenInternal = all.filter((r) => r.state.applicable && r.isAdmin).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Vendor activation
          </h1>
          <p className="text-muted mt-1">
            Who can&apos;t sell yet, and who&apos;s worth contacting today.
          </p>
        </div>
        <Link
          href={showInternal ? "/admin/activation" : "/admin/activation?internal=1"}
          className="inline-flex items-center justify-center min-h-11 text-sm font-medium px-3.5 py-2 rounded-lg border border-line-strong hover:border-ink/30 transition whitespace-nowrap"
        >
          {showInternal ? "Hide" : "Show"} internal accounts
          {!showInternal && hiddenInternal > 0 ? ` (${hiddenInternal})` : ""}
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <Stat label="Needs help" value={String(nNeedsHelp)} sub="Built a drop, no Stripe" />
        <Stat label="Selling paused" value={String(nPaused)} sub="Stripe restricted" />
        <Stat label="Ready to sell" value={String(nReady)} sub="Charge-ready" />
      </div>

      <Group
        title="⏸️ Selling paused"
        hint="was able to sell — Stripe has stopped them"
        rows={paused}
        tone="text-brand-dark"
      />
      <Group
        title="⚠️ Needs help"
        hint="built a drop but can't take payments"
        rows={needsHelp}
        tone="text-ink"
      />
      <Group
        title="Everyone else"
        hint="ready to sell, or no drop built yet"
        rows={rest}
        tone="text-muted"
      />

      {visible.length === 0 && (
        <p className="text-muted">No vendors to show.</p>
      )}

      <p className="text-xs text-muted mt-8 max-w-2xl">
        States come from the same derivation the vendor&apos;s own dashboard uses, so
        what you see here is what they see. “Never published” is inferred from drop
        status — DropQ can&apos;t yet tell whether a vendor <em>attempted</em> to
        publish and was blocked.
      </p>
    </div>
  );
}
