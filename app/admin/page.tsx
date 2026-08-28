import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { grantAdminByEmailAction, setAdminAction, sendTestEmailAction, sendTestSmsAction } from "@/lib/actions/admin";
import { formatMoney, relativeTime, formatDate } from "@/lib/format";
import { Stat } from "@/components/dashboard-ui";
import { Badge, Button, Input } from "@/components/ui";
import { ConfirmSubmit } from "@/components/confirm-submit";
import {
  effectivePlan,
  planLabel,
  isPartnerExpired,
  dropsRemaining,
  STARTER_DROP_LIMIT,
  type Plan,
} from "@/lib/plans";
import { DEMO_SELLER_EMAIL } from "@/lib/demo";

const PAID = ["new", "in_progress", "ready", "completed", "fulfilled"];

const PLAN_BADGE: Record<Plan, string> = {
  starter: "bg-line text-ink-soft",
  growth: "bg-brand-tint text-brand-dark",
  partner: "bg-sage-tint text-sage",
  pro: "bg-quad/15 text-tertiary",
};

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{
    admin?: string;
    email?: string;
    deleted?: string;
    test?: string;
    testmsg?: string;
    sms?: string;
    smsmsg?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await requireAdmin();

  // Non-secret delivery config status (never expose the API key/token values).
  const emailConfig = {
    resendKeySet: !!process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || null,
    appUrl: process.env.APP_URL || null,
  };
  const smsConfig = {
    accountSet: !!process.env.TWILIO_ACCOUNT_SID,
    tokenSet: !!process.env.TWILIO_AUTH_TOKEN,
    sender:
      process.env.TWILIO_MESSAGING_SERVICE_SID
        ? "Messaging Service"
        : process.env.TWILIO_FROM_NUMBER || null,
    enabled:
      !!process.env.TWILIO_ACCOUNT_SID &&
      !!process.env.TWILIO_AUTH_TOKEN &&
      (!!process.env.TWILIO_MESSAGING_SERVICE_SID || !!process.env.TWILIO_FROM_NUMBER),
  };
  const [sellers, sales, customerGroups, liveDrops, subs, proWaitlist, referrals] = await Promise.all([
    prisma.seller.findMany({
      // The marketing demo store is a visual showcase only — keep it out of Vendors.
      where: { email: { not: DEMO_SELLER_EMAIL } },
      include: { _count: { select: { drops: true, orders: true, subscribers: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.groupBy({
      by: ["sellerId"],
      where: { status: { in: PAID } },
      _sum: { totalCents: true, feeCents: true },
      _count: true,
      _max: { createdAt: true },
    }),
    prisma.order.groupBy({
      by: ["sellerId", "buyerEmail"],
      where: { status: { in: PAID } },
      _count: true,
    }),
    prisma.drop.findMany({ where: { status: "live" }, select: { sellerId: true }, distinct: ["sellerId"] }),
    prisma.subscriber.count(),
    prisma.proWaitlist.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.referral.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        referrer: { select: { storeName: true } },
        referred: { select: { storeName: true } },
      },
    }),
  ]);
  const rewardedReferrals = referrals.filter((r) => r.status === "rewarded").length;

  const salesMap = new Map(sales.map((s) => [s.sellerId, s]));
  const liveSet = new Set(liveDrops.map((d) => d.sellerId));
  const custCount = new Map<string, number>();
  for (const g of customerGroups) custCount.set(g.sellerId, (custCount.get(g.sellerId) ?? 0) + 1);

  const gmv = sales.reduce((s, x) => s + (x._sum.totalCents ?? 0), 0);
  const dropqRevenue = sales.reduce((s, x) => s + (x._sum.feeCents ?? 0), 0);
  const totalOrders = sales.reduce((s, x) => s + x._count, 0);
  const totalDrops = sellers.reduce((s, x) => s + x._count.drops, 0);
  const admins = sellers.filter((s) => s.isAdmin);

  // ---- Plan analytics ----
  const planCount: Record<Plan, number> = { starter: 0, growth: 0, partner: 0, pro: 0 };
  for (const s of sellers) planCount[effectivePlan(s)]++;
  const partners = sellers.filter((s) => s.plan === "partner");
  const growthSubs = sellers.filter(
    (s) => effectivePlan(s) === "growth" && s.subscriptionStatus === "active"
  );
  const starterNearLimit = sellers.filter(
    (s) => effectivePlan(s) === "starter" && dropsRemaining(s) <= 1
  );

  function status(sellerId: string, orders: number) {
    if (liveSet.has(sellerId)) return { label: "Live drop", cls: "bg-sage-tint text-sage" };
    if (orders > 0) return { label: "Selling", cls: "bg-brand-tint text-brand-dark" };
    return { label: "New", cls: "bg-line text-ink-soft" };
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Vendors</h1>
        <p className="text-muted mt-1">Every vendor on DropQ.</p>
      </div>

      {sp.deleted && (
        <p className="mb-5 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">
          ✓ Vendor deleted.
        </p>
      )}

      {/* Email delivery status + test button */}
      <div className="mb-8 rounded-card border border-line bg-paper p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-lg">Email &amp; SMS delivery</h2>
            <p className="text-sm text-muted mt-0.5">
              How DropQ sends order confirmations, status updates, and alerts.
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <dt className="text-muted w-28">Email</dt>
                <dd className="flex items-center gap-2">
                  {emailConfig.resendKeySet ? (
                    <Badge className="bg-sage-tint text-sage">Live</Badge>
                  ) : (
                    <Badge className="bg-brand-tint text-brand-dark">Not set</Badge>
                  )}
                  <span className="text-muted">via Resend</span>
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="text-muted w-28">Email sender</dt>
                <dd>
                  {emailConfig.from ?? (
                    <span className="text-brand-dark">Not set — emails may not reach customers</span>
                  )}
                </dd>
              </div>
              <div className="flex items-center gap-3 pt-2 mt-1 border-t border-line">
                <dt className="text-muted w-28">Text messages</dt>
                <dd className="flex items-center gap-2">
                  {smsConfig.enabled ? (
                    <Badge className="bg-sage-tint text-sage">Live</Badge>
                  ) : (
                    <Badge className="bg-brand-tint text-brand-dark">Not configured</Badge>
                  )}
                  <span className="text-muted">via Twilio</span>
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="text-muted w-28">Text sender</dt>
                <dd>{smsConfig.sender ?? <span className="text-brand-dark">Not set</span>}</dd>
              </div>
            </dl>
          </div>
          {/* Each test sits on one line — its context to the left, its action
              right-aligned so the two buttons stack in a clean column. */}
          <div className="shrink-0 space-y-3">
            <form
              action={sendTestEmailAction}
              className="flex flex-wrap items-center justify-end gap-3"
            >
              <p className="text-sm text-muted">Sends to {me.email}.</p>
              <Button type="submit" variant="dark" className="w-56">Send test email to me</Button>
            </form>

            <div>
              <form
                action={sendTestSmsAction}
                className="flex flex-wrap items-center justify-end gap-3"
              >
                <input
                  name="phone"
                  type="tel"
                  required
                  placeholder="+1 555 000 1234"
                  aria-label="Phone number for the test message"
                  className="w-48 bg-paper border border-line-strong rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition"
                />
                <Button type="submit" variant="secondary" className="w-56">Send test SMS</Button>
              </form>
              <p className="text-sm text-muted mt-1.5">Texts that number via Twilio.</p>
            </div>
          </div>
        </div>

        {sp.test === "sent" && (
          <p className="mt-4 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">
            ✓ Test email accepted by Resend — check {me.email} (and spam).
          </p>
        )}
        {sp.test === "fail" && (
          <p className="mt-4 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
            ✕ Test email failed: {sp.testmsg || "Unknown error."}
          </p>
        )}
        {sp.sms === "sent" && (
          <div className="mt-4 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">
            ✓ Twilio accepted the message{sp.smsmsg ? ` (${sp.smsmsg})` : ""}.
            <div className="text-ink-soft mt-1">
              If it doesn&rsquo;t arrive, the failure is at the carrier — open{" "}
              <b>Twilio Console → Monitor → Logs → Messaging</b> and find that SID to see the exact
              delivery status and error code.
            </div>
          </div>
        )}
        {sp.sms === "fail" && (
          <p className="mt-4 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
            ✕ Test SMS rejected by Twilio: {sp.smsmsg || "Unknown error."}
          </p>
        )}
      </div>

      {/* Platform totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Stat label="Vendors" value={String(sellers.length)} />
        <Stat label="GMV" value={formatMoney(gmv)} sub="Total sales" />
        <Stat label="DropQ revenue" value={formatMoney(dropqRevenue)} sub="Platform fees" />
        <Stat label="Orders" value={String(totalOrders)} sub={`${totalDrops} drops`} />
        <Stat label="Sign-ups" value={String(subs)} sub="Across all stores" />
      </div>

      {/* Plans overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Free" value={String(planCount.starter)} sub={`${starterNearLimit.length} near limit`} />
        <Stat label="Basic" value={String(planCount.growth)} sub={`${growthSubs.length} paying`} />
        <Stat label="Partner" value={String(planCount.partner)} sub="Early Partner Program" />
        <Stat label="Pro waitlist" value={String(proWaitlist.length)} sub="Coming soon" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-8">
        {/* Partner expirations */}
        <div className="bg-paper border border-line rounded-card p-5">
          <h2 className="font-semibold mb-3">Partner plans <span className="text-muted font-normal">({partners.length})</span></h2>
          {partners.length === 0 ? (
            <p className="text-sm text-muted">No Partner accounts yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {partners.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <Link href={`/admin/${p.id}`} className="font-medium hover:underline truncate">{p.storeName}</Link>
                  <span className={isPartnerExpired(p) ? "text-brand-dark" : "text-muted"}>
                    {p.partnerExpiresAt ? (isPartnerExpired(p) ? `expired ${formatDate(p.partnerExpiresAt)}` : `until ${formatDate(p.partnerExpiresAt)}`) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Starters approaching the limit */}
        <div className="bg-paper border border-line rounded-card p-5">
          <h2 className="font-semibold mb-3">Free accounts near limit <span className="text-muted font-normal">({starterNearLimit.length})</span></h2>
          {starterNearLimit.length === 0 ? (
            <p className="text-sm text-muted">None approaching the {STARTER_DROP_LIMIT}-drop limit.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {starterNearLimit.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <Link href={`/admin/${s.id}`} className="font-medium hover:underline truncate">{s.storeName}</Link>
                  <span className="text-muted">{s.dropsCreated}/{STARTER_DROP_LIMIT} used</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pro waitlist */}
        <div className="bg-paper border border-line rounded-card p-5">
          <h2 className="font-semibold mb-3">Pro waitlist <span className="text-muted font-normal">({proWaitlist.length})</span></h2>
          {proWaitlist.length === 0 ? (
            <p className="text-sm text-muted">No signups yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm max-h-44 overflow-y-auto">
              {proWaitlist.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{w.email}</span>
                  <span className="text-muted text-xs shrink-0">{formatDate(w.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Referrals */}
      <div className="bg-paper border border-line rounded-card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">
            Referrals <span className="text-muted font-normal">({referrals.length})</span>
          </h2>
          <span className="text-sm text-muted">{rewardedReferrals} reward{rewardedReferrals !== 1 ? "s" : ""} granted</span>
        </div>
        {referrals.length === 0 ? (
          <p className="text-sm text-muted">No referrals yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {referrals.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <b>{r.referrer.storeName}</b> <span className="text-muted">referred</span> {r.referred.storeName}
                </span>
                <span className="shrink-0 flex items-center gap-2 text-muted">
                  <Badge className={r.status === "rewarded" ? "bg-sage-tint text-sage" : "bg-line text-ink-soft"}>
                    {r.status === "rewarded" ? "rewarded" : "signed up"}
                  </Badge>
                  {formatDate(r.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Admins */}
      <div className="bg-paper border border-line rounded-card p-5 mb-6">
        <h2 className="font-semibold mb-3">
          Admins <span className="text-muted font-normal">({admins.length})</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {admins.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 border border-line rounded-pill bg-cream/60 pl-3 pr-1.5 py-1"
            >
              <Link href={`/admin/${a.id}`} className="text-sm font-medium hover:underline">
                {a.storeName}
              </Link>
              <span className="text-xs text-muted hidden sm:inline">{a.email}</span>
              {a.id === me.id ? (
                <span className="text-[11px] text-muted bg-line rounded-pill px-2 py-0.5">you</span>
              ) : (
                <form action={setAdminAction}>
                  <input type="hidden" name="targetId" value={a.id} />
                  <input type="hidden" name="makeAdmin" value="false" />
                  <ConfirmSubmit
                    message={`Remove admin access from ${a.email}?`}
                    className="text-muted hover:text-white hover:bg-brand rounded-full w-5 h-5 grid place-items-center text-xs transition"
                  >
                    ✕
                  </ConfirmSubmit>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Vendors table */}
      <div className="bg-paper border border-line rounded-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_1fr_0.7fr_0.7fr_1fr_1fr] gap-3 px-5 py-3 border-b border-line text-xs font-semibold uppercase tracking-wide text-muted">
          <span>Vendor</span>
          <span>Status</span>
          <span className="text-right">Drops</span>
          <span className="text-right">Orders</span>
          <span className="text-right">Sales</span>
          <span className="text-right">Last activity</span>
        </div>
        <div className="divide-y divide-line">
          {sellers.map((s) => {
            const sale = salesMap.get(s.id);
            const st = status(s.id, sale?._count ?? 0);
            const last = sale?._max.createdAt ?? s.createdAt;
            return (
              <Link
                key={s.id}
                href={`/admin/${s.id}`}
                className="grid grid-cols-2 md:grid-cols-[2fr_1fr_0.7fr_0.7fr_1fr_1fr] gap-2 md:gap-3 px-5 py-3.5 items-center hover:bg-cream/60 transition"
              >
                <div className="min-w-0 col-span-2 md:col-span-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{s.storeName}</span>
                    <Badge className={PLAN_BADGE[effectivePlan(s)]}>{planLabel(effectivePlan(s))}</Badge>
                    {s.isAdmin && <Badge className="bg-ink text-cream">admin</Badge>}
                  </div>
                  <p className="text-xs text-muted truncate">{s.email}</p>
                </div>
                <div><Badge className={st.cls}>{st.label}</Badge></div>
                <span className="text-sm text-right hidden md:block">{s._count.drops}</span>
                <span className="text-sm text-right hidden md:block">{sale?._count ?? 0}</span>
                <span className="text-sm font-semibold text-right">{formatMoney(sale?._sum.totalCents ?? 0)}</span>
                <span className="text-sm text-muted text-right hidden md:block">{relativeTime(last)}</span>
                <span className="text-xs text-muted md:hidden col-span-2">
                  {s._count.drops} drops · {custCount.get(s.id) ?? 0} customers · joined {formatDate(s.createdAt)}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Grant admin — parked at the bottom left. It's a rare, privileged
          action, so it shouldn't compete with the page heading. Its result
          messages live here too; confirming a submit at the top of a long page
          would land off-screen. */}
      <div className="mt-10 pt-6 border-t border-line max-w-md">
        {sp.admin === "granted" && (
          <p className="mb-4 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">
            ✓ {sp.email} is now a DropQ admin.
          </p>
        )}
        {sp.admin === "notfound" && (
          <p className="mb-4 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
            No DropQ account found for {sp.email}. They need to sign up first, then grant admin.
          </p>
        )}
        <form action={grantAdminByEmailAction} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Grant admin by email</label>
            <Input name="email" type="email" placeholder="teammate@email.com" className="w-56" />
          </div>
          <Button type="submit" variant="dark">Make admin</Button>
        </form>
        <p className="text-xs text-muted mt-2">
          Full access to every vendor, order, and payout. They must already have a DropQ account.
        </p>
      </div>
    </div>
  );
}
