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
    // Either a Messaging Service (recommended for A2P 10DLC) or a plain number.
    (!!process.env.TWILIO_MESSAGING_SERVICE_SID || !!process.env.TWILIO_FROM_NUMBER)
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

export type SmsResult = {
  ok: boolean;
  skipped?: boolean; // Twilio not configured — logged instead of sent
  status?: number;
  error?: string;
  sid?: string; // Twilio message SID (for looking up delivery in Twilio logs)
  providerStatus?: string; // Twilio message status at creation (queued/accepted)
};

/** Send a single SMS. No-op (logs) when Twilio isn't configured. */
export async function sendSms(
  to: string | null | undefined,
  body: string
): Promise<SmsResult> {
  if (!to) return { ok: false, error: "No phone number." };
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: "Invalid phone number." };

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM_NUMBER;

  // Need auth + a sender: a Messaging Service (preferred for A2P 10DLC) or a number.
  if (!sid || !token || (!messagingServiceSid && !from)) {
    console.log(`\n──── 📱 SMS (dev — set TWILIO_* to send) ────\nTo: ${phone}\n${body}\n────────────────────────────────────────────\n`);
    return { ok: false, skipped: true, error: "Twilio is not configured." };
  }

  // MessagingServiceSid routes through your registered A2P campaign + number
  // pool; fall back to a single From number if no service is configured.
  const params: Record<string, string> = { To: phone, Body: body };
  if (messagingServiceSid) params.MessagingServiceSid = messagingServiceSid;
  else params.From = from as string;

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(params).toString(),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      console.error("Twilio SMS failed:", res.status, text);
      // Surface Twilio's human-readable message when present.
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        if (j?.message) msg = `${j.message}${j.code ? ` (code ${j.code})` : ""}`;
      } catch {
        /* keep raw */
      }
      return { ok: false, status: res.status, error: msg };
    }
    let sid: string | undefined;
    let providerStatus: string | undefined;
    try {
      const j = await res.json();
      sid = j?.sid;
      providerStatus = j?.status;
    } catch {
      /* ignore */
    }
    return { ok: true, status: res.status, sid, providerStatus };
  } catch (e) {
    console.error("Twilio SMS error:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
            message.url ? `<p><a href="${message.url}" style="color:#ff6268">${message.url}</a></p>` : ""
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
