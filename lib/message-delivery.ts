import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail, newMessageEmail, vendorNewMessageEmail } from "@/lib/email";
import { sendSms } from "@/lib/notifications";

/**
 * Delivery channels for a DropQ message.
 *
 * The Message row in Postgres is the source of truth — always. Everything here
 * is a *pointer* to it: an email or SMS that says "you have a message on DropQ"
 * and links back. Nothing in this file ever creates, mutates, or reads message
 * content as though the channel were the store. That's what keeps SMS a
 * drop-in addition rather than a rewrite.
 *
 * Every attempt is recorded in MessageDelivery so a failed channel is visible
 * and retryable without the conversation ever being at risk.
 */

export type Channel = "in_app" | "email" | "sms" | "push";

export function appUrl(): string {
  return process.env.APP_URL?.replace(/\/$/, "") || "https://www.drop-q.com";
}

async function record(
  messageId: string,
  channel: Channel,
  status: "sent" | "skipped" | "failed",
  detail?: string | null
) {
  await prisma.messageDelivery
    .upsert({
      where: { messageId_channel: { messageId, channel } },
      create: { messageId, channel, status, detail: detail ?? null, sentAt: status === "sent" ? new Date() : null },
      update: { status, detail: detail ?? null, sentAt: status === "sent" ? new Date() : null },
    })
    .catch((e) => console.error(`MessageDelivery ${channel} write failed:`, e));
}

export type DeliveryTarget = {
  messageId: string;
  /** Who is being notified. */
  recipient: "vendor" | "customer";
  email?: string | null;
  phone?: string | null;
  /** Deep link to the conversation. */
  link: string;
  preview: string;
  announcement?: boolean;
  /** Vendor branding, used for customer-facing mail. */
  storeName?: string;
  logoUrl?: string | null;
  accent?: string | null;
  /** Customer display name, used for vendor-facing mail. */
  customerName?: string;
  /** Customer's SMS marketing consent. Gates the SMS channel entirely. */
  smsConsent?: boolean;
};

/**
 * SMS is wired but off by default. It stays dark until DropQ's A2P 10DLC
 * campaign is approved and the recipient has given express written consent —
 * flip MESSAGING_SMS_ENABLED=true to turn it on. Until then every send is
 * recorded as "skipped" with the reason, so nothing is silently lost.
 */
function smsChannelEnabled(): boolean {
  return process.env.MESSAGING_SMS_ENABLED === "true";
}

/** In-app is implicit — the Message row itself. Recorded for a complete audit. */
export async function deliverInApp(messageId: string) {
  await record(messageId, "in_app", "sent");
}

/**
 * Fan a message notification out to the optional channels. Never throws: a
 * dead provider must not roll back a message that's already stored.
 */
export async function deliverNotifications(t: DeliveryTarget): Promise<void> {
  await deliverInApp(t.messageId);

  // ── Email ────────────────────────────────────────────────────────────────
  if (t.email) {
    try {
      const mail =
        t.recipient === "customer"
          ? newMessageEmail({
              to: t.email,
              storeName: t.storeName ?? "Your store",
              logoUrl: t.logoUrl,
              accent: t.accent,
              preview: t.preview,
              link: t.link,
              announcement: t.announcement,
            })
          : vendorNewMessageEmail({
              to: t.email,
              customerName: t.customerName ?? "A customer",
              preview: t.preview,
              link: t.link,
            });
      const res = await sendEmail(mail);
      await record(
        t.messageId,
        "email",
        res.ok ? "sent" : res.skipped ? "skipped" : "failed",
        res.error ?? null
      );
    } catch (e) {
      await record(t.messageId, "email", "failed", e instanceof Error ? e.message : String(e));
    }
  } else {
    await record(t.messageId, "email", "skipped", "no email on file");
  }

  // ── SMS ──────────────────────────────────────────────────────────────────
  // Deliberately a notification, never the conversation record: the body is a
  // pointer back into DropQ, not the message text.
  if (!smsChannelEnabled()) {
    await record(t.messageId, "sms", "skipped", "sms channel disabled (MESSAGING_SMS_ENABLED)");
  } else if (t.recipient === "customer" && !t.smsConsent) {
    await record(t.messageId, "sms", "skipped", "no sms consent on file");
  } else if (!t.phone) {
    await record(t.messageId, "sms", "skipped", "no phone on file");
  } else {
    try {
      const who = t.recipient === "customer" ? t.storeName ?? "A store" : t.customerName ?? "A customer";
      const res = await sendSms(t.phone, `${who} messaged you on DropQ: ${t.preview} ${t.link}`);
      await record(t.messageId, "sms", res.ok ? "sent" : res.skipped ? "skipped" : "failed", res.error ?? res.sid ?? null);
    } catch (e) {
      await record(t.messageId, "sms", "failed", e instanceof Error ? e.message : String(e));
    }
  }

  // ── Push ─────────────────────────────────────────────────────────────────
  // No client to push to yet; the row keeps the channel visible in the audit.
  await record(t.messageId, "push", "skipped", "no push client registered");
}
