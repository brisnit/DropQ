import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/notifications";
import { HELP_REPLY, STOP_REPLY } from "@/lib/sms-consent";

/**
 * Inbound SMS webhook — STOP / HELP / START.
 *
 * Twilio's Advanced Opt-Out (if enabled on the Messaging Service) already stops
 * delivery at their edge and auto-replies. That is necessary but not
 * sufficient: without this endpoint DropQ's own database never learns about the
 * opt-out, so we keep queuing sends and hold no auditable record of when
 * someone unsubscribed. This persists it.
 *
 * Replying with empty TwiML avoids double-texting when Advanced Opt-Out is
 * already answering. Set TWILIO_REPLY_INLINE=true only if it is disabled.
 */

const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"];
const START_WORDS = ["start", "unstop", "yes"];
const HELP_WORDS = ["help", "info"];

/** Twilio signs every request; an unsigned one is not from Twilio. */
function verifySignature(url: string, params: Record<string, string>, signature: string): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function twiml(message?: string) {
  const body = message
    ? `<Response><Message>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message></Response>`
    : "<Response></Response>";
  return new NextResponse(body, { headers: { "Content-Type": "text/xml" } });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const signature = request.headers.get("x-twilio-signature") ?? "";
  const url = process.env.APP_URL
    ? `${process.env.APP_URL.replace(/\/$/, "")}/api/twilio/inbound`
    : request.url;

  if (!verifySignature(url, params, signature)) {
    console.error("Twilio inbound: bad signature", { from: params.From });
    return new NextResponse("forbidden", { status: 403 });
  }

  const from = normalizePhone(params.From ?? "");
  const word = (params.Body ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!from) return twiml();

  // Match on the stored number however it was formatted at capture.
  const digits = from.replace(/\D/g, "").slice(-10);
  const customers = await prisma.customer.findMany({
    where: { phone: { contains: digits } },
    select: { id: true },
  });

  const inline = process.env.TWILIO_REPLY_INLINE === "true";

  if (STOP_WORDS.includes(word)) {
    // Global kill switch plus both flags, so nothing can resurrect the send.
    await prisma.customer.updateMany({
      where: { id: { in: customers.map((c) => c.id) } },
      data: {
        smsOptedOutAt: new Date(),
        smsOptOutSource: "stop_reply",
        smsTransactionalConsent: false,
        smsMarketingConsent: false,
      },
    });
    console.log(`Twilio inbound STOP from ${from} — ${customers.length} customer(s) opted out`);
    return twiml(inline ? STOP_REPLY : undefined);
  }

  if (START_WORDS.includes(word)) {
    // Clears the block, but does NOT re-grant consent — that requires ticking
    // the box again, so a stray "yes" can never re-subscribe anyone.
    await prisma.customer.updateMany({
      where: { id: { in: customers.map((c) => c.id) } },
      data: { smsOptedOutAt: null, smsOptOutSource: null },
    });
    return twiml(inline ? "DropQ: you can opt back in at https://www.drop-q.com/sms" : undefined);
  }

  if (HELP_WORDS.includes(word)) {
    return twiml(inline ? HELP_REPLY : undefined);
  }

  // Anything else is a customer replying to a vendor; the in-app thread is the
  // canonical store, so nothing to do here yet.
  return twiml();
}
