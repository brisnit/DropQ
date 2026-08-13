import "server-only";
import { prisma } from "@/lib/db";
import { sendSms, type SmsResult } from "@/lib/notifications";
import { consentRequiredFor, type SmsKind } from "@/lib/sms-consent";

/**
 * The single gate every customer-facing SMS must pass through.
 *
 * Resolves the recipient's consent from the Customer record — the one source
 * of truth — and refuses to send when the required consent is absent. A global
 * STOP blocks everything except security codes, which are user-initiated and
 * carrier-exempt.
 *
 * Returns a skipped result rather than throwing: a blocked message is a normal
 * outcome, not an error, and must never break an order flow.
 */
export type GatedResult = SmsResult & { blockedReason?: string; kind: SmsKind };

export async function sendGatedSms(input: {
  kind: SmsKind;
  body: string;
  /** Preferred: resolves consent directly. */
  customerId?: string | null;
  /** Fallback for order paths that only hold an email. */
  email?: string | null;
  /** Number to text. Falls back to the customer's stored phone. */
  to?: string | null;
}): Promise<GatedResult> {
  const { kind, body } = input;
  const required = consentRequiredFor(kind);

  // Internal/B2B and security sends never touch customer consent.
  if (required === null) {
    const res = await sendSms(input.to, body);
    return { ...res, kind };
  }

  const customer = input.customerId
    ? await prisma.customer.findUnique({ where: { id: input.customerId } })
    : input.email
      ? await prisma.customer.findUnique({ where: { email: input.email.toLowerCase() } })
      : null;

  if (!customer) {
    return { ok: false, skipped: true, kind, blockedReason: "no customer record — cannot verify consent" };
  }

  if (customer.smsOptedOutAt) {
    return { ok: false, skipped: true, kind, blockedReason: "customer replied STOP" };
  }

  const granted =
    required === "marketing" ? customer.smsMarketingConsent : customer.smsTransactionalConsent;
  if (!granted) {
    return { ok: false, skipped: true, kind, blockedReason: `no ${required} SMS consent on file` };
  }

  const to = input.to ?? customer.phone;
  if (!to) return { ok: false, skipped: true, kind, blockedReason: "no phone number" };

  const res = await sendSms(to, body);
  return { ...res, kind };
}

/** Record a consent decision with full provenance. */
export async function recordSmsConsent(input: {
  customerId: string;
  transactional?: boolean;
  marketing?: boolean;
  source: string;
  disclosureVersion: string;
}): Promise<void> {
  const now = new Date();
  const data: Record<string, unknown> = { smsConsentDisclosureVersion: input.disclosureVersion };

  if (input.transactional !== undefined) {
    data.smsTransactionalConsent = input.transactional;
    data.smsTransactionalConsentAt = input.transactional ? now : null;
    data.smsTransactionalConsentSource = input.transactional ? input.source : null;
  }
  if (input.marketing !== undefined) {
    data.smsMarketingConsent = input.marketing;
    data.smsMarketingConsentAt = input.marketing ? now : null;
    data.smsMarketingConsentSource = input.marketing ? input.source : null;
  }
  // Opting back in clears a prior STOP.
  if (input.transactional || input.marketing) {
    data.smsOptedOutAt = null;
    data.smsOptOutSource = null;
  }

  await prisma.customer.update({ where: { id: input.customerId }, data }).catch((e) =>
    console.error("recordSmsConsent failed:", e)
  );
}
