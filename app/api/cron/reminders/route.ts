import type { NextRequest } from "next/server";
import { runRepeatReminders } from "@/lib/reminders";
import { convertExpiredPartners } from "@/lib/billing";

// Daily repeat-customer reminders. Wired to Vercel Cron via vercel.json.
// Protected by CRON_SECRET (Vercel sends it as a Bearer token automatically
// when the env var is set).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  const result = await runRepeatReminders();
  const partnersConverted = await convertExpiredPartners();
  return Response.json({ ok: true, ...result, partnersConverted });
}
