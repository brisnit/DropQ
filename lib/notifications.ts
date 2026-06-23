import "server-only";
import { sendEmail } from "@/lib/email";

/**
 * Channel-agnostic notification abstraction.
 * - "email" → Resend (real).
 * - "sms"   → Twilio when TWILIO_* env vars are set; otherwise logs (dev).
 * - "push"  → placeholder for a future mobile client.
 */
export type NotifyChannel = "email" | "sms" | "push";

export type NotifyTarget = { email?: string | null; phone?: string | null };
export type NotifyMessage = { subject: string; body: string; url?: string };

/** Whether real SMS sending is configured. */
export function smsEnabled(): boolean {
  return (
    !!process.env.TWILIO_ACCOUNT_SID &&
    !!process.env.TWILIO_AUTH_TOKEN &&
    !!process.env.TWILIO_FROM_NUMBER
  );
}

/** E.164-ish normalization: assume US if 10 digits and no country code. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : "";
}

/** Send a single SMS. No-op (logs) when Twilio isn't configured. */
export async function sendSms(to: string | null | undefined, body: string): Promise<void> {
  if (!to) return;
  const phone = normalizePhone(to);
  if (!phone) return;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    console.log(`\n──── 📱 SMS (dev — set TWILIO_* to send) ────\nTo: ${phone}\n${body}\n────────────────────────────────────────────\n`);
    return;
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phone, From: from, Body: body }).toString(),
      }
    );
    if (!res.ok) console.error("Twilio SMS failed:", res.status, await res.text());
  } catch (e) {
    console.error("Twilio SMS error:", e);
  }
}

export async function notify(
  target: NotifyTarget,
  message: NotifyMessage,
  channels: NotifyChannel[] = ["email"]
): Promise<void> {
  for (const channel of channels) {
    try {
      if (channel === "email" && target.email) {
        await sendEmail({
          to: target.email,
          subject: message.subject,
          html: `<div style="font-family:sans-serif;color:#1a1a1a"><p>${message.body}</p>${
            message.url ? `<p><a href="${message.url}" style="color:#ff666c">${message.url}</a></p>` : ""
          }</div>`,
        });
      } else if (channel === "sms" && target.phone) {
        await sendSms(target.phone, message.url ? `${message.body} ${message.url}` : message.body);
      } else if (channel === "push") {
        console.log(`[notify:push placeholder] :: ${message.subject}`);
      }
    } catch (e) {
      console.error(`notify(${channel}) failed:`, e);
    }
  }
}
