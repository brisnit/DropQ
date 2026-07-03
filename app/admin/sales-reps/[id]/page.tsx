import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  updateSalesRepAction,
  setRepPasswordAction,
  deleteSalesRepAction,
  markCommissionPaidAction,
  voidCommissionAction,
  bulkMarkRepPaidAction,
} from "@/lib/actions/sales-reps";
import { statsForRep } from "@/lib/commission-stats";
import { formatMoney, formatDate } from "@/lib/format";
import { Stat } from "@/components/dashboard-ui";
import { Badge, Button, Input } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { ConfirmSubmit } from "@/components/confirm-submit";

export const metadata = { title: "Sales Rep — DropQ Admin" };

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-quad/15 text-ink-soft",
  approved: "bg-brand-tint text-brand-dark",
  paid: "bg-sage-tint text-sage",
  voided: "bg-line text-muted",
};

export default async function SalesRepDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; created?: string; pwset?: string; bulkpaid?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;

  const rep = await prisma.salesRep.findUnique({ where: { id } });
  if (!rep) notFound();

  const [stats, vendors, ledger] = await Promise.all([
    statsForRep(id),
    prisma.seller.findMany({
      where: { salesRepId: id },
      select: { id: true, storeName: true, slug: true, referredAt: true, disabledAt: true, createdAt: true },
      orderBy: { referredAt: "desc" },
    }),
    prisma.commissionLedger.findMany({
      where: { salesRepId: id },
      include: { vendor: { select: { storeName: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  const base = process.env.APP_URL?.replace(/\/$/, "") || "https://www.drop-q.com";
  const link = `${base}/vendor/signup?ref=${rep.referralCode}`;
  const back = `/admin/sales-reps/${id}`;

  return (
    <div>
      <Link href="/admin/sales-reps" className="text-sm text-muted hover:text-ink">← All sales reps</Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mt-2 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight">{rep.name}</h1>
            <Badge className={rep.status === "active" ? "bg-sage-tint text-sage" : "bg-line text-ink-soft"}>{rep.status}</Badge>
          </div>
          <p className="text-muted mt-1">{rep.email} · rep since {formatDate(rep.createdAt)}</p>
        </div>
      </div>

      {sp.saved && <p className="mb-4 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">✓ Saved.</p>}
      {sp.created && <p className="mb-4 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">✓ Sales rep created. Share their signup link below.</p>}
      {sp.pwset && <p className="mb-4 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">✓ Portal password set — the rep can now log in at /rep/login.</p>}
      {sp.bulkpaid && <p className="mb-4 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">✓ Marked all unpaid commission as paid.</p>}
      {sp.error && <p className="mb-4 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">{sp.error.replace(/\+/g, " ")}</p>}

      {/* Referral code + link */}
      <div className="bg-paper border border-line rounded-card p-5 mb-6 flex flex-wrap items-center gap-4">
        <div>
          <p className="text-xs text-muted mb-1">Referral code</p>
          <code className="font-mono text-lg font-semibold bg-cream border border-line rounded px-2 py-1">{rep.referralCode}</code>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={rep.referralCode} label="Copy code" />
          <CopyButton text={link} label="Copy signup link" />
        </div>
        <p className="text-xs text-muted w-full break-all">{link}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
        <Stat label="Vendors" value={String(stats.vendorCount)} />
        <Stat label="Vendor sales" value={formatMoney(stats.vendorSalesCents)} />
        <Stat label="DropQ rev" value={formatMoney(stats.dropqRevenueCents)} />
        <Stat label="Accrued" value={formatMoney(stats.accruedCents)} />
        <Stat label="Paid" value={formatMoney(stats.paidCents)} />
        <Stat label="Unpaid" value={formatMoney(stats.unpaidCents)} />
      </div>

      {/* Edit + password */}
      <div className="grid lg:grid-cols-2 gap-4 mb-8">
        <form action={updateSalesRepAction} className="bg-paper border border-line rounded-card p-5 space-y-3">
          <input type="hidden" name="id" value={rep.id} />
          <h2 className="font-semibold">Edit rep</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Name</label>
              <Input name="name" defaultValue={rep.name} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Email</label>
              <Input name="email" type="email" defaultValue={rep.email} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Referral code</label>
              <Input name="referralCode" defaultValue={rep.referralCode} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Commission %</label>
              <Input name="commissionPercent" type="number" step="0.1" min="0" defaultValue={String(rep.commissionRate * 100)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Status</label>
              <select name="status" defaultValue={rep.status} className="w-full bg-paper border border-line-strong rounded-xl px-3.5 py-2.5 text-ink focus:outline-none focus:border-brand">
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </div>
          </div>
          <Button type="submit" variant="dark">Save changes</Button>
        </form>

        <form action={setRepPasswordAction} className="bg-paper border border-line rounded-card p-5 space-y-3">
          <input type="hidden" name="id" value={rep.id} />
          <h2 className="font-semibold">Portal access</h2>
          <p className="text-sm text-muted">
            {rep.passwordHash ? "Password set — the rep can log in at /rep/login." : "Set a password to give this rep a read-only login."}
          </p>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{rep.passwordHash ? "Reset password" : "Set password"}</label>
            <Input name="password" type="password" placeholder="At least 8 characters" minLength={8} />
          </div>
          <Button type="submit" variant="secondary">{rep.passwordHash ? "Reset password" : "Set password"}</Button>
        </form>
      </div>

      {/* Referred vendors */}
      <div className="mb-8">
        <h2 className="font-semibold text-lg mb-3">Referred vendors ({vendors.length})</h2>
        {vendors.length === 0 ? (
          <p className="text-sm text-muted bg-paper border border-dashed border-line-strong rounded-card p-6 text-center">
            No vendors have signed up with this code yet.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {vendors.map((v) => (
              <div key={v.id} className="bg-paper border border-line rounded-card p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{v.storeName}</p>
                  <p className="text-xs text-muted">Referred {v.referredAt ? formatDate(v.referredAt) : "—"}</p>
                </div>
                <Badge className={v.disabledAt ? "bg-line text-muted" : "bg-sage-tint text-sage"}>
                  {v.disabledAt ? "suspended" : "active"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Commission ledger */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-lg">Commission ledger</h2>
          <div className="flex items-center gap-2">
            <a
              href={`/admin/commissions/export?rep=${rep.id}`}
              className="text-sm font-medium text-ink px-3 py-2 rounded-lg border border-line-strong bg-paper hover:border-ink/30"
            >
              Export CSV
            </a>
            {stats.unpaidCents > 0 && (
              <form action={bulkMarkRepPaidAction}>
                <input type="hidden" name="salesRepId" value={rep.id} />
                <input type="hidden" name="back" value={back} />
                <ConfirmSubmit
                  message={`Mark all unpaid commission (${formatMoney(stats.unpaidCents)}) for ${rep.name} as paid?`}
                  className="text-sm font-semibold bg-ink text-white px-3 py-2 rounded-lg hover:bg-ink-soft"
                >
                  Mark all paid ({formatMoney(stats.unpaidCents)})
                </ConfirmSubmit>
              </form>
            )}
          </div>
        </div>
        {ledger.length === 0 ? (
          <p className="text-sm text-muted bg-paper border border-dashed border-line-strong rounded-card p-6 text-center">
            No commission entries yet.
          </p>
        ) : (
          <div className="overflow-x-auto border border-line rounded-card bg-paper">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3 text-right">Order</th>
                  <th className="px-4 py-3 text-right">Base</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3 text-right">Commission</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((c) => (
                  <tr key={c.id} className="border-b border-line/60">
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(c.createdAt)}</td>
                    <td className="px-4 py-3">{c.vendor.storeName}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(c.grossOrderAmount)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(c.commissionBaseAmount)}</td>
                    <td className="px-4 py-3 text-right">{(c.commissionRate * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatMoney(c.commissionAmount)}</td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_STYLE[c.status] ?? "bg-line text-ink-soft"}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {(c.status === "pending" || c.status === "approved") && (
                        <div className="flex items-center gap-2 justify-end">
                          <form action={markCommissionPaidAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="back" value={back} />
                            <button type="submit" className="text-brand font-medium hover:underline">Mark paid</button>
                          </form>
                          <form action={voidCommissionAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="back" value={back} />
                            <button type="submit" className="text-muted hover:text-ink">Void</button>
                          </form>
                        </div>
                      )}
                      {c.status === "paid" && c.paidAt && (
                        <span className="text-xs text-muted">paid {formatDate(c.paidAt)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Danger zone */}
      <form action={deleteSalesRepAction} className="mt-10 pt-6 border-t border-line">
        <input type="hidden" name="id" value={rep.id} />
        <ConfirmSubmit
          message={`Delete ${rep.name}? Their commission history is removed and their referred vendors are un-attributed. This can't be undone.`}
          className="text-sm text-brand-dark hover:underline"
        >
          Delete this sales rep
        </ConfirmSubmit>
      </form>
    </div>
  );
}
