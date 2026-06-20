import "server-only";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";

const DAY = 86_400_000;
const WINDOW = 2 * DAY; // catch each milestone within a 2-day window (daily cron)

const MILESTONES = [
  { kind: "d30", days: 30, label: "It's been about a month" },
  { kind: "d90", days: 90, label: "It's been about 3 months" },
] as const;

/**
 * Repeat-customer reminders: nudge customers ~30 days and ~3 months after their
 * last order. Deduped via ReminderLog (never sends the same milestone twice).
 * Email is real (Resend); SMS is a placeholder until Twilio is wired in.
 * Intended to be run daily by a cron job (see /api/cron/reminders).
 */
export async function runRepeatReminders(now: number = Date.now()): Promise<{ sent: number; considered: number }> {
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";

  const orders = await prisma.order.findMany({
    where: { status: { in: ["new", "in_progress", "ready", "completed", "fulfilled"] } },
    orderBy: { createdAt: "desc" },
    select: {
      sellerId: true,
      buyerEmail: true,
      buyerPhone: true,
      createdAt: true,
      seller: { select: { storeName: true, slug: true } },
    },
  });

  // Most recent order per (seller, customer email)
  const lastByCustomer = new Map<string, (typeof orders)[number]>();
  for (const o of orders) {
    const key = `${o.sellerId}:${o.buyerEmail}`;
    if (!lastByCustomer.has(key)) lastByCustomer.set(key, o);
  }

  let sent = 0;
  for (const o of lastByCustomer.values()) {
    const age = now - o.createdAt.getTime();
    for (const m of MILESTONES) {
      const target = m.days * DAY;
      if (age < target || age >= target + WINDOW) continue;

      const already = await prisma.reminderLog.findUnique({
        where: { sellerId_email_kind: { sellerId: o.sellerId, email: o.buyerEmail, kind: m.kind } },
      });
      if (already) continue;

      await prisma.reminderLog.create({
        data: { sellerId: o.sellerId, email: o.buyerEmail, kind: m.kind },
      });
      await notify(
        { email: o.buyerEmail, phone: o.buyerPhone },
        {
          subject: `${o.seller.storeName} misses you 👋`,
          body: `${m.label} since your last order from ${o.seller.storeName}. See what's dropping next.`,
          url: `${base}/s/${o.seller.slug}`,
        },
        ["email", "sms"]
      );
      sent++;
    }
  }

  return { sent, considered: lastByCustomer.size };
}
