import Link from "next/link";
import { headers } from "next/headers";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney, formatDate, relativeTime, statusStyle } from "@/lib/format";
import { hasGrowthBonus } from "@/lib/plans";
import { getOrCreateReferralCode } from "@/lib/referral";
import { Stat, PageHeader, Section } from "@/components/dashboard-ui";
import { LinkButton, Badge } from "@/components/ui";
import { CopyLinkButton } from "@/components/copy-link-button";

export const metadata = { title: "Overview — DropQ" };

export default async function OverviewPage() {
  const seller = await requireSeller();

  const [drops, recentOrders, agg, customers, newOrders] = await Promise.all([
    prisma.drop.findMany({
      where: { sellerId: seller.id },
      include: { products: true, _count: { select: { orders: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.findMany({
      where: { sellerId: seller.id, status: { not: "pending" } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { _count: { select: { items: true } }, drop: { select: { title: true } } },
    }),
    prisma.order.aggregate({
      where: { sellerId: seller.id, status: { not: "pending" } },
      _sum: { totalCents: true },
      _count: true,
    }),
    prisma.order.findMany({
      where: { sellerId: seller.id, status: { not: "pending" } },
      distinct: ["buyerEmail"],
      select: { buyerEmail: true },
    }),
    prisma.order.count({ where: { sellerId: seller.id, status: "new" } }),
  ]);

  const revenue = agg._sum.totalCents ?? 0;
  const liveDrop = drops.find((d) => d.status === "live");
  const draftDrop = drops.find((d) => d.status === "draft");

  // Referral program
  const referralCode = await getOrCreateReferralCode(seller);
  const referrals = await prisma.referral.findMany({
    where: { referrerId: seller.id },
    orderBy: { createdAt: "desc" },
    include: { referred: { select: { storeName: true } } },
  });
  const h = await headers();
  const base =
    process.env.APP_URL?.replace(/\/$/, "") ??
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const referralLink = `${base}/signup?ref=${referralCode}`;
  const rewardedCount = referrals.filter((r) => r.status === "rewarded").length;
  const referralHistory = referrals.slice(0, 5).map((r) => ({
    name: r.referred.storeName,
    status: r.status,
    date: formatDate(r.createdAt),
  }));
  const bonusUntil = hasGrowthBonus(seller) ? formatDate(seller.growthBonusUntil!) : null;

  // What should they do next?
  let next: { tone: string; title: string; body: string; href: string; cta: string };
  if (drops.length === 0) {
    next = {
      tone: "bg-brand text-white",
      title: "Let's get your first drop live",
      body: "Add a few items, set quantities, and share one link. You can be selling in minutes.",
      href: "/dashboard/drops/new",
      cta: "Create your first drop",
    };
  } else if (newOrders > 0) {
    next = {
      tone: "bg-ink text-cream",
      title: `${newOrders} order${newOrders > 1 ? "s" : ""} to prepare`,
      body: "New orders are in. Mark them ready as you go so nothing slips through.",
      href: "/dashboard/orders",
      cta: "Review orders",
    };
  } else if (draftDrop && !liveDrop) {
    next = {
      tone: "bg-brand text-white",
      title: "Your drop is ready to publish",
      body: `“${draftDrop.title}” is a draft. Publish it to start taking orders and notify your followers.`,
      href: `/dashboard/drops/${draftDrop.id}`,
      cta: "Open the drop",
    };
  } else if (liveDrop) {
    next = {
      tone: "bg-sage text-white",
      title: "Your drop is live and selling",
      body: "Everything's caught up. Keep an eye on inventory and share your link to drive more orders.",
      href: `/dashboard/drops/${liveDrop.id}`,
      cta: "View live drop",
    };
  } else {
    next = {
      tone: "bg-brand text-white",
      title: "Time for your next drop",
      body: "Your last drop wrapped. Spin up a fresh menu and bring your customers back.",
      href: "/dashboard/drops/new",
      cta: "Start a new drop",
    };
  }

  return (
    <Section>
      <PageHeader
        title={`Welcome back, ${seller.storeName}`}
        subtitle="Here's what's happening with your store today."
        action={<LinkButton href="/dashboard/drops/new">+ New drop</LinkButton>}
      />

      {/* Next action */}
      <div className={`rounded-card p-6 sm:p-7 mb-7 flex flex-wrap items-center justify-between gap-4 ${next.tone}`}>
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
            Next step
          </p>
          <h2 className="font-display text-2xl font-semibold mt-1">{next.title}</h2>
          <p className="opacity-90 mt-1.5">{next.body}</p>
        </div>
        <Link
          href={next.href}
          className="bg-white/95 text-ink font-medium px-5 py-3 rounded-xl hover:bg-white transition whitespace-nowrap"
        >
          {next.cta} →
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Revenue" value={formatMoney(revenue)} sub="All time" />
        <Stat label="Orders" value={String(agg._count)} sub={`${newOrders} need prep`} />
        <Stat label="Customers" value={String(customers.length)} sub="Unique buyers" />
        <Stat
          label="Live drop"
          value={liveDrop ? "1" : "0"}
          sub={liveDrop ? liveDrop.title.slice(0, 22) : "None active"}
        />
      </div>

      {/* Referral program */}
      <div className="bg-ink text-cream rounded-card p-6 sm:p-7 mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-grey">Refer &amp; earn</p>
        <h2 className="font-display text-2xl font-semibold mt-1">Invite a vendor. Earn free Growth.</h2>
        <p className="text-cream/75 mt-1.5 max-w-xl text-sm">
          Know another vendor who could use DropQ? Share your referral link. When they
          sign up and subscribe to Growth, you&apos;ll get one free month of Growth — on us.
        </p>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input
            readOnly
            value={referralLink}
            className="flex-1 min-w-0 bg-cream/10 border border-cream/20 rounded-xl px-3.5 py-2.5 text-sm font-mono text-cream/90 focus:outline-none focus:border-cream/50"
          />
          <CopyLinkButton
            value={referralLink}
            className="shrink-0 bg-cream text-ink font-medium rounded-xl px-5 py-2.5 hover:bg-white transition"
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-sm text-cream/70">
          <span><b className="text-cream">{referrals.length}</b> signed up</span>
          <span><b className="text-cream">{rewardedCount}</b> reward{rewardedCount !== 1 ? "s" : ""} granted</span>
          {bonusUntil && (
            <span>🎁 Free Growth active until <b className="text-cream">{bonusUntil}</b></span>
          )}
        </div>
        {referralHistory.length > 0 && (
          <div className="mt-4 border-t border-cream/15 pt-3 space-y-1.5">
            {referralHistory.map((hItem, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-cream/90 truncate">{hItem.name}</span>
                <span className="shrink-0 flex items-center gap-2 text-cream/60">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-pill ${
                      hItem.status === "rewarded" ? "bg-sage/30 text-sage" : "bg-cream/10 text-cream/80"
                    }`}
                  >
                    {hItem.status === "rewarded" ? "Reward granted" : "Signed up"}
                  </span>
                  {hItem.date}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Live drop snapshot */}
        <div>
          <h3 className="font-semibold mb-3">Live drop</h3>
          {liveDrop ? (
            <div className="bg-paper border border-line rounded-card p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="font-medium">{liveDrop.title}</span>
                <Badge className={statusStyle("live")}>
                  <span className="w-1.5 h-1.5 rounded-full bg-sage live-dot" /> Live
                </Badge>
              </div>
              <div className="space-y-3">
                {liveDrop.products.map((p) => {
                  const pct = p.inventory ? Math.round((p.sold / p.inventory) * 100) : 0;
                  return (
                    <div key={p.id}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="truncate">{p.emoji} {p.name}</span>
                        <span className="text-muted shrink-0 ml-2">{p.sold}/{p.inventory}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-line overflow-hidden">
                        <div className="h-full bg-brand rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <LinkButton href={`/dashboard/drops/${liveDrop.id}`} variant="secondary" size="sm" className="mt-5 w-full">
                Manage drop
              </LinkButton>
            </div>
          ) : (
            <div className="bg-paper border border-dashed border-line-strong rounded-card p-8 text-center">
              <p className="text-muted">No live drop right now.</p>
              <LinkButton href="/dashboard/drops/new" size="sm" className="mt-4">
                Create a drop
              </LinkButton>
            </div>
          )}
        </div>

        {/* Recent orders */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Recent orders</h3>
            <Link href="/dashboard/orders" className="text-sm text-brand hover:underline">
              View all
            </Link>
          </div>
          <div className="bg-paper border border-line rounded-card divide-y divide-line">
            {recentOrders.length === 0 && (
              <p className="p-6 text-muted text-sm text-center">No orders yet.</p>
            )}
            {recentOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{o.buyerName}</p>
                  <p className="text-xs text-muted truncate">
                    {o._count.items} item{o._count.items > 1 ? "s" : ""} · {relativeTime(o.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Badge className={statusStyle(o.status)}>{o.status}</Badge>
                  <span className="text-sm font-semibold w-16 text-right">
                    {formatMoney(o.totalCents)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
