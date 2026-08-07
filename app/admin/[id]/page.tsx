import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { setAdminAction, setPlanAction, deleteVendorAction, setSellerDisabledAction } from "@/lib/actions/admin";
import { setVendorSalesRepAction } from "@/lib/actions/sales-reps";
import { formatMoney, formatDate, relativeTime, statusStyle } from "@/lib/format";
import { Stat } from "@/components/dashboard-ui";
import { Badge, Button, Select } from "@/components/ui";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { BackLink } from "@/components/back-link";
import {
  effectivePlan,
  planLabel,
  isPartnerExpired,
  dropsRemaining,
  STARTER_DROP_LIMIT,
  type Plan,
} from "@/lib/plans";

const PAID = ["new", "in_progress", "ready", "completed", "fulfilled"];

const PLAN_BADGE: Record<Plan, string> = {
  starter: "bg-line text-ink-soft",
  growth: "bg-brand-tint text-brand-dark",
  partner: "bg-sage-tint text-sage",
  pro: "bg-quad/15 text-tertiary",
};

export default async function AdminClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ plan?: string; suspend?: string }>;
}) {
  const { id } = await params;
  const { plan: planUpdated, suspend } = await searchParams;
  const me = await requireAdmin();
  const seller = await prisma.seller.findUnique({
    where: { id },
    include: {
      drops: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { orders: true, products: true } } },
      },
      _count: { select: { subscribers: true } },
      salesRep: { select: { id: true, name: true } },
    },
  });
  if (!seller) notFound();

  const allReps = await prisma.salesRep.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  const [agg, customerGroups, recent] = await Promise.all([
    prisma.order.aggregate({
      where: { sellerId: id, status: { in: PAID } },
      _sum: { totalCents: true, feeCents: true },
      _count: true,
    }),
    prisma.order.groupBy({ by: ["buyerEmail"], where: { sellerId: id, status: { in: PAID } }, _count: true }),
    prisma.order.findMany({
      where: { sellerId: id, status: { not: "pending" } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { drop: { select: { title: true } } },
    }),
  ]);

  const sales = agg._sum.totalCents ?? 0;
  const fees = agg._sum.feeCents ?? 0;

  return (
    <div>
      <BackLink href="/admin">All vendors</BackLink>

      <div className="flex flex-wrap items-start justify-between gap-4 mt-3 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight">{seller.storeName}</h1>
            <Badge className={PLAN_BADGE[effectivePlan(seller)]}>{planLabel(effectivePlan(seller))}</Badge>
            {seller.isAdmin && <Badge className="bg-ink text-cream">admin</Badge>}
            {seller.stripeChargesEnabled && <Badge className="bg-sage-tint text-sage">payouts on</Badge>}
            {seller.disabledAt && <Badge className="bg-brand-tint text-brand-dark">suspended</Badge>}
          </div>
          <p className="text-muted mt-1">
            {seller.email} · /s/{seller.slug} · joined {formatDate(seller.createdAt)}
            {seller.location ? ` · ${seller.location}` : ""}
          </p>
        </div>
        {/* Admin grant/revoke lives with the other account-level actions at the
            bottom of the page, so the header carries only navigation. */}
        <div className="flex items-center gap-2">
          {seller.id === me.id && (
            <span className="text-sm text-muted px-3 py-2.5">That&apos;s you</span>
          )}
          <Link
            href={`/s/${seller.slug}`}
            target="_blank"
            className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            View storefront ↗
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Stat label="Sales" value={formatMoney(sales)} />
        <Stat label="DropQ fees" value={formatMoney(fees)} />
        <Stat label="Orders" value={String(agg._count)} />
        <Stat label="Customers" value={String(customerGroups.length)} />
        <Stat label="Sign-ups" value={String(seller._count.subscribers)} />
      </div>

      {/* Sales-rep attribution */}
      <div className="bg-paper border border-line rounded-card p-5 mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Sales rep attribution</h2>
            {seller.salesRep ? (
              <p className="text-sm text-muted mt-0.5">
                Referred by{" "}
                <Link href={`/admin/sales-reps/${seller.salesRep.id}`} className="text-brand font-medium hover:underline">
                  {seller.salesRep.name}
                </Link>
                {seller.referredAt ? ` · since ${formatDate(seller.referredAt)}` : ""}
              </p>
            ) : (
              <p className="text-sm text-muted mt-0.5">Not attributed to any sales rep.</p>
            )}
          </div>
          <form action={setVendorSalesRepAction} className="flex items-end gap-2">
            <input type="hidden" name="vendorId" value={seller.id} />
            <select
              name="salesRepId"
              defaultValue={seller.salesRep?.id ?? ""}
              className="bg-paper border border-line-strong rounded-xl px-3 py-2 text-sm"
            >
              <option value="">— No rep —</option>
              {allReps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Button type="submit" variant="secondary">Save</Button>
          </form>
        </div>
      </div>

      {/* Plan management */}
      <div className="bg-paper border border-line rounded-card p-5 mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Plan & billing</h2>
            <p className="text-sm text-muted mt-1">
              On <b>{planLabel(effectivePlan(seller))}</b>
              {effectivePlan(seller) === "starter" && ` · ${seller.dropsCreated}/${STARTER_DROP_LIMIT} drops used (${dropsRemaining(seller)} left)`}
              {seller.subscriptionStatus ? ` · subscription ${seller.subscriptionStatus}` : ""}
              {seller.plan === "partner" && seller.partnerExpiresAt
                ? ` · ${isPartnerExpired(seller) ? "expired" : "free until"} ${formatDate(seller.partnerExpiresAt)}`
                : ""}
            </p>
          </div>
          <form action={setPlanAction} className="flex items-end gap-2">
            <input type="hidden" name="targetId" value={seller.id} />
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Set plan</label>
              <Select name="plan" defaultValue={seller.plan} className="w-40">
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="partner">Partner (resets 12mo)</option>
                <option value="pro">Pro</option>
              </Select>
            </div>
            <Button type="submit" variant="dark">Update</Button>
          </form>
        </div>
        {planUpdated === "updated" && (
          <p className="mt-3 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">✓ Plan updated.</p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Drops */}
        <div>
          <h2 className="font-semibold mb-3">Drops ({seller.drops.length})</h2>
          <div className="bg-paper border border-line rounded-card divide-y divide-line">
            {seller.drops.length === 0 && <p className="p-5 text-sm text-muted">No drops yet.</p>}
            {seller.drops.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.title}</p>
                  <p className="text-xs text-muted">{d._count.products} items · {d._count.orders} orders · {formatDate(d.createdAt)}</p>
                </div>
                <Badge className={statusStyle(d.status)}>{d.status}</Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div>
          <h2 className="font-semibold mb-3">Recent activity</h2>
          <div className="bg-paper border border-line rounded-card divide-y divide-line">
            {recent.length === 0 && <p className="p-5 text-sm text-muted">No orders yet.</p>}
            {recent.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{o.buyerName}</p>
                  <p className="text-xs text-muted truncate">{o.drop.title} · {relativeTime(o.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={statusStyle(o.status)}>{o.status}</Badge>
                  <span className="text-sm font-semibold">{formatMoney(o.totalCents)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Account-level actions — admin access, suspension, deletion */}
      {suspend === "on" && (
        <p className="mt-6 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">🚫 Vendor suspended — they can no longer log in and their storefront is offline.</p>
      )}
      {suspend === "off" && (
        <p className="mt-6 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">✓ Vendor reinstated.</p>
      )}

      {seller.id !== me.id && (
        <div className="mt-10 pt-6 border-t border-line space-y-5">
          {/* Admin access */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">
                {seller.isAdmin ? "Revoke admin access" : "Make this vendor an admin"}
              </p>
              <p className="text-sm text-muted">
                {seller.isAdmin
                  ? `${seller.storeName} can currently see every vendor, order, and payout on DropQ. Revoking leaves their own store untouched.`
                  : "Grants access to the whole DropQ admin area — every vendor, order, payout, and setting across the platform."}
              </p>
            </div>
            <form action={setAdminAction}>
              <input type="hidden" name="targetId" value={seller.id} />
              <input type="hidden" name="makeAdmin" value={seller.isAdmin ? "false" : "true"} />
              <ConfirmSubmit
                message={
                  seller.isAdmin
                    ? `Remove admin access from ${seller.email}?`
                    : `Give ${seller.email} admin access to all of DropQ? They'll be able to see and change every vendor, order, and payout.`
                }
                className="text-sm font-semibold px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
              >
                {seller.isAdmin ? "Revoke admin" : "Make admin"}
              </ConfirmSubmit>
            </form>
          </div>

          {/* Suspend / reinstate */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-5 border-t border-line">
            <div>
              <p className="font-semibold">{seller.disabledAt ? "Reinstate this vendor" : "Suspend this vendor"}</p>
              <p className="text-sm text-muted">
                {seller.disabledAt
                  ? `Suspended ${formatDate(seller.disabledAt)}. Reinstating restores login and brings their storefront back online.`
                  : "Blocks login and takes their storefront offline. Reversible — their data is kept."}
              </p>
            </div>
            <form action={setSellerDisabledAction}>
              <input type="hidden" name="targetId" value={seller.id} />
              <input type="hidden" name="disable" value={seller.disabledAt ? "false" : "true"} />
              {seller.disabledAt ? (
                <Button type="submit" variant="dark">Reinstate</Button>
              ) : (
                <ConfirmSubmit
                  message={`Suspend ${seller.storeName}? They'll be logged out and their storefront goes offline until you reinstate them.`}
                  className="text-sm font-semibold px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-brand hover:text-brand transition"
                >
                  Suspend access
                </ConfirmSubmit>
              )}
            </form>
          </div>

          {/* Delete */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-5 border-t border-line">
            <div>
              <p className="font-semibold text-brand-dark">Delete this vendor</p>
              <p className="text-sm text-muted">
                Permanently removes {seller.storeName}, their storefront, drops, products, orders, and reviews. This cannot be undone.
              </p>
            </div>
            <form action={deleteVendorAction}>
              <input type="hidden" name="targetId" value={seller.id} />
              <ConfirmSubmit
                message={`Are you sure? This permanently deletes ${seller.storeName} and ALL of their drops, orders, products, and reviews. This cannot be undone.`}
                className="text-sm font-semibold px-4 py-2.5 rounded-xl bg-brand text-white hover:bg-brand-dark transition"
              >
                Delete vendor
              </ConfirmSubmit>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
