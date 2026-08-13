import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail, dropClosedEmail } from "@/lib/email";
import { sendSms } from "@/lib/notifications";
import { sendGatedSms } from "@/lib/sms-gate";
import { formatPickupWindow, pickupLocation } from "@/lib/pickup";
import { dropMapsUrl } from "@/lib/maps";

const DAY = 24 * 60 * 60 * 1000;

function baseUrl() {
  return process.env.APP_URL?.replace(/\/$/, "") || "https://www.drop-q.com";
}

/**
 * Auto-close expired preorder drops (server time) and broadcast a "your order is
 * locked in" email + SMS to buyers of drops that just closed. Idempotent: each
 * drop is atomically claimed (live → closed), so only the run that closes it
 * broadcasts, exactly once. Long-expired drops are closed without a broadcast so
 * we never text customers about drops that ended long ago.
 */
export async function closeExpiredDrops(now: Date = new Date()): Promise<{ closed: number; notified: number }> {
  // 1) Close long-expired live drops silently.
  const stale = await prisma.drop.updateMany({
    where: { status: "live", mode: "preorder", closesAt: { lt: new Date(now.getTime() - DAY) } },
    data: { status: "closed" },
  });

  // 2) Recently-expired live drops → close + broadcast.
  const recent = await prisma.drop.findMany({
    where: { status: "live", mode: "preorder", closesAt: { lt: now, gte: new Date(now.getTime() - DAY) } },
    include: {
      seller: {
        select: {
          storeName: true, timezone: true, logoUrl: true, accent: true,
          pickupContactPhone: true, pickupContactPref: true,
        },
      },
    },
  });

  let closed = stale.count;
  let notified = 0;
  const base = baseUrl();

  for (const d of recent) {
    const claim = await prisma.drop.updateMany({
      where: { id: d.id, status: "live" },
      data: { status: "closed" },
    });
    if (claim.count === 0) continue; // already closed by another run
    closed++;

    const orders = await prisma.order.findMany({
      where: { dropId: d.id, status: { in: ["new", "in_progress", "ready"] } },
      select: { id: true, buyerName: true, buyerEmail: true, buyerPhone: true,
      customerId: true },
    });
    const win = formatPickupWindow(d, d.seller.timezone);
    const where = pickupLocation(d);
    const mapsUrl = dropMapsUrl(d);
    const store = d.seller.storeName;

    for (const o of orders) {
      const first = o.buyerName.split(" ")[0] || o.buyerName;
      try {
        await sendEmail(
          dropClosedEmail({
            to: o.buyerEmail,
            storeName: store,
            buyerFirst: first,
            dropTitle: d.title,
            orderLink: `${base}/order/${o.id}`,
            pickupWindow: win,
            pickupWhere: where,
            pickupNotes: d.pickupNotes,
            pickupFindMe: d.pickupFindMe,
            mapsUrl,
            contactPhone: d.seller.pickupContactPhone,
            contactPref: d.seller.pickupContactPref,
            logoUrl: d.seller.logoUrl,
            accent: d.seller.accent,
          })
        );
        const sms =
          `${store}: the "${d.title}" drop is over and your order is locked in.` +
          (win ? ` Pickup ${win}${where ? ` at ${where}` : ""}.` : "") +
          (mapsUrl ? ` Directions: ${mapsUrl}` : "");
        await sendGatedSms({ kind: "transactional", body: sms, customerId: o.customerId, email: o.buyerEmail, to: o.buyerPhone });
        notified++;
      } catch (e) {
        console.error("drop-closed broadcast failed:", e);
      }
    }
  }

  return { closed, notified };
}
