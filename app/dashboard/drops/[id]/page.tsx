import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  updateDropAction,
  updateDropStatusAction,
  deleteDropAction,
  updateOrderStatusAction,
} from "@/lib/actions/dashboard";
import { formatMoney, formatDateTime, relativeTime, statusStyle } from "@/lib/format";
import { Section } from "@/components/dashboard-ui";
import { Badge, Button, Field, Input, Textarea, Select } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { StatusSelect } from "@/components/status-select";
import { ConfirmSubmit } from "@/components/confirm-submit";

export default async function DropDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seller = await requireSeller();

  const drop = await prisma.drop.findUnique({
    where: { id },
    include: {
      products: { orderBy: { sortOrder: "asc" } },
      orders: {
        where: { status: { not: "pending" } },
        orderBy: { createdAt: "desc" },
        include: { items: true },
      },
    },
  });
  if (!drop || drop.sellerId !== seller.id) notFound();

  const h = await headers();
  const host = h.get("host") ?? "localhost:3001";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const shareUrl = `${proto}://${host}/s/${seller.slug}/${drop.id}`;
  const qrDataUrl = await QRCode.toDataURL(shareUrl, {
    width: 360,
    margin: 1,
    color: { dark: "#1b1726", light: "#ffffff" },
  });

  const revenue = drop.orders.reduce((s, o) => s + o.totalCents, 0);
  const sold = drop.products.reduce((s, p) => s + p.sold, 0);
  const stock = drop.products.reduce((s, p) => s + p.inventory, 0);

  return (
    <Section>
      <Link href="/dashboard/drops" className="text-sm text-muted hover:text-ink">
        ← Back to drops
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mt-3 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
              {drop.title}
            </h1>
            <Badge className={statusStyle(drop.status)}>{drop.status}</Badge>
          </div>
          {drop.pickupInfo && <p className="text-muted mt-1">{drop.fulfillment} · {drop.pickupInfo}</p>}
        </div>

        <div className="flex items-center gap-2">
          {drop.status === "draft" && (
            <form action={updateDropStatusAction}>
              <input type="hidden" name="dropId" value={drop.id} />
              <input type="hidden" name="status" value="live" />
              <Button type="submit">Publish drop</Button>
            </form>
          )}
          {drop.status === "live" && (
            <form action={updateDropStatusAction}>
              <input type="hidden" name="dropId" value={drop.id} />
              <input type="hidden" name="status" value="closed" />
              <Button type="submit" variant="secondary">Close drop</Button>
            </form>
          )}
          {drop.status === "closed" && (
            <form action={updateDropStatusAction}>
              <input type="hidden" name="dropId" value={drop.id} />
              <input type="hidden" name="status" value="live" />
              <Button type="submit" variant="secondary">Reopen</Button>
            </form>
          )}
          <Link
            href={`/s/${seller.slug}/${drop.id}`}
            target="_blank"
            className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            View ↗
          </Link>
        </div>
      </div>

      {/* Share */}
      <div className="bg-ink text-cream rounded-card p-5 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-cream/60">Share this drop</p>
          <p className="font-mono text-sm truncate mt-0.5">{shareUrl}</p>
        </div>
        <CopyButton text={shareUrl} />
      </div>

      {/* Edit details + QR */}
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <details className="bg-paper border border-line rounded-card group">
          <summary className="list-none cursor-pointer px-5 py-4 flex items-center justify-between font-medium">
            <span>✏️ Edit drop details</span>
            <span className="text-muted text-sm transition group-open:rotate-180">▾</span>
          </summary>
          <form action={updateDropAction} className="px-5 pb-5 pt-4 border-t border-line space-y-4">
            <input type="hidden" name="dropId" value={drop.id} />
            <Field label="Drop name">
              <Input name="title" defaultValue={drop.title} required />
            </Field>
            <Field label="Description">
              <Textarea name="description" defaultValue={drop.description ?? ""} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Fulfillment">
                <Select name="fulfillment" defaultValue={drop.fulfillment}>
                  <option value="pickup">Pickup</option>
                  <option value="delivery">Local delivery</option>
                  <option value="shipping">Shipping</option>
                </Select>
              </Field>
              <Field label="Pickup / delivery details">
                <Input name="pickupInfo" defaultValue={drop.pickupInfo ?? ""} />
              </Field>
            </div>
            <Button type="submit">Save changes</Button>
          </form>
        </details>

        <details className="bg-paper border border-line rounded-card group">
          <summary className="list-none cursor-pointer px-5 py-4 flex items-center justify-between font-medium">
            <span>📱 QR code</span>
            <span className="text-muted text-sm transition group-open:rotate-180">▾</span>
          </summary>
          <div className="px-5 pb-5 pt-4 border-t border-line flex flex-col sm:flex-row items-center gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="QR code linking to this drop"
              width={150}
              height={150}
              className="rounded-xl border border-line shrink-0"
            />
            <div className="text-center sm:text-left">
              <p className="text-sm text-muted">
                Print it on a flyer, sign, or your market table. Scanning it opens
                this drop&apos;s order page.
              </p>
              <a
                href={qrDataUrl}
                download={`dropq-${seller.slug}-${drop.id}.png`}
                className="inline-block mt-3 text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
              >
                ↓ Download PNG
              </a>
            </div>
          </div>
        </details>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-paper border border-line rounded-card p-4">
          <p className="text-xs text-muted uppercase tracking-wide">Revenue</p>
          <p className="font-display text-2xl font-semibold mt-1">{formatMoney(revenue)}</p>
        </div>
        <div className="bg-paper border border-line rounded-card p-4">
          <p className="text-xs text-muted uppercase tracking-wide">Orders</p>
          <p className="font-display text-2xl font-semibold mt-1">{drop.orders.length}</p>
        </div>
        <div className="bg-paper border border-line rounded-card p-4">
          <p className="text-xs text-muted uppercase tracking-wide">Sold</p>
          <p className="font-display text-2xl font-semibold mt-1">{sold}/{stock}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Items */}
        <div className="lg:col-span-2">
          <h2 className="font-semibold mb-3">Menu ({drop.products.length})</h2>
          <div className="bg-paper border border-line rounded-card divide-y divide-line">
            {drop.products.map((p) => {
              const pct = p.inventory ? Math.round((p.sold / p.inventory) * 100) : 0;
              const out = p.inventory > 0 && p.sold >= p.inventory;
              return (
                <div key={p.id} className="p-4">
                  <div className="flex items-center gap-3">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={p.name} className="w-11 h-11 rounded-lg object-cover border border-line shrink-0" />
                    ) : (
                      <span className="w-11 h-11 rounded-lg bg-cream grid place-items-center text-xl shrink-0">{p.emoji}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{p.name}</p>
                      {p.description && <p className="text-xs text-muted truncate">{p.description}</p>}
                    </div>
                    <span className="font-semibold">{formatMoney(p.priceCents)}</span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="h-1.5 flex-1 rounded-full bg-line overflow-hidden">
                      <div className={`h-full rounded-full ${out ? "bg-brand" : "bg-sage"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <span className="text-xs text-muted shrink-0">
                      {out ? "Sold out" : `${p.sold}/${p.inventory}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Orders */}
        <div className="lg:col-span-3">
          <h2 className="font-semibold mb-3">Orders ({drop.orders.length})</h2>
          {drop.orders.length === 0 ? (
            <div className="bg-paper border border-dashed border-line-strong rounded-card p-8 text-center text-muted">
              No orders yet. Share your link to start selling.
            </div>
          ) : (
            <div className="space-y-3">
              {drop.orders.map((o) => (
                <div key={o.id} className="bg-paper border border-line rounded-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{o.buyerName}</p>
                      <p className="text-xs text-muted">
                        {o.buyerEmail}
                        {o.buyerPhone ? ` · ${o.buyerPhone}` : ""} · {relativeTime(o.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-semibold">{formatMoney(o.totalCents)}</span>
                      <StatusSelect action={updateOrderStatusAction} orderId={o.id} value={o.status} />
                    </div>
                  </div>
                  <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                    {o.items.map((it) => (
                      <li key={it.id}>
                        <span className="text-muted">{it.quantity}×</span> {it.name}
                      </li>
                    ))}
                  </ul>
                  {o.note && <p className="mt-2 text-sm text-muted italic">“{o.note}”</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Danger zone */}
      <div className="mt-10 pt-6 border-t border-line flex items-center justify-between">
        <p className="text-sm text-muted">Created {formatDateTime(drop.createdAt)}</p>
        <form action={deleteDropAction}>
          <input type="hidden" name="dropId" value={drop.id} />
          <ConfirmSubmit
            message="Delete this drop and all its orders? This can't be undone."
            className="text-sm text-muted hover:text-brand transition"
          >
            Delete drop
          </ConfirmSubmit>
        </form>
      </div>
    </Section>
  );
}
