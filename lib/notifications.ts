import "server-only";
import { sendEmail } from "@/lib/email";

/**
 * Channel-agnostic notification abstraction.
 *
 * - "email" is wired to Resend (real).
 * - "sms" and "push" are placeholders that log; swap in Twilio / FCM / APNs / a
 *   web-push provider later without changing call sites.
 */
export type NotifyChannel = "email" | "sms" | "push";

export type NotifyTarget = {
  email?: string | null;
  phone?: string | null;
  // pushToken?: string | null; // future
};

export type NotifyMessage = {
  subject: string;
  body: string;
  url?: string;
};

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
          html: `<div style="font-family:sans-serif;color:#1b1726">
            <p>${message.body}</p>
            ${message.url ? `<p><a href="${message.url}" style="color:#6d28d9">${message.url}</a></p>` : ""}
          </div>`,
        });
      } else if (channel === "sms" && target.phone) {
        // TODO: integrate Twilio (TWILIO_* env vars) — placeholder for now.
        console.log(`[notify:sms placeholder] to=${target.phone} :: ${message.subject} — ${message.body}`);
      } else if (channel === "push") {
        // TODO: integrate web-push / FCM / APNs — placeholder for now.
        console.log(`[notify:push placeholder] :: ${message.subject} — ${message.body}`);
      }
    } catch (e) {
      console.error(`notify(${channel}) failed:`, e);
    }
  }
}

/** Whether real SMS sending is configured (placeholder check for future Twilio). */
export function smsEnabled(): boolean {
  return !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;
}
