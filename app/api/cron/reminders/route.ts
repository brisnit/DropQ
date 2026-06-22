import type { NextRequest } from "next/server";
import { runRepeatReminders } from "@/lib/reminders";
import { convertExpiredPartners } from "@/lib/billing";
import { reconcilePendingOrders } from "@/lib/checkout";

// Daily maintenance cron. Wired to Vercel Cron via vercel.json.
// Protected by CRON_SECRET (Vercel sends it as a Bearer token automatically
// when the env var is set). Trims trailing whitespace defensively.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = (req.headers.get("authorization") ?? "").trim();
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  const result = await runRepeatReminders();
  const partnersConverted = await convertExpiredPartners();
  // Backstop for paid-but-stuck / abandoned Stripe orders.
  const reconciled = await reconcilePendingOrders(15);
  return Response.json({ ok: true, ...result, partnersConverted, reconciled });
}
