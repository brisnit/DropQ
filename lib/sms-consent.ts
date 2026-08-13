/**
 * DropQ SMS consent — the single source of truth.
 *
 * Two independent consents, never inferred from each other or from anything
 * else. Creating an account, entering a phone number, buying something,
 * accepting Terms, or following a vendor grant NO SMS consent.
 *
 *   TRANSACTIONAL — account, orders, payments, pickups, platform activity
 *   MARKETING     — vendors, drops and products the customer chose to follow
 *
 * The exact disclosure text is versioned here so a stored consent can be tied
 * back to the wording the customer actually saw. Bump DISCLOSURE_VERSION
 * whenever the wording changes; never edit a version in place.
 *
 * Client-safe (no Prisma) so forms can render the same strings the server records.
 */

export const DISCLOSURE_VERSION = "2026-08-13.v1";

export const TRANSACTIONAL_DISCLOSURE =
  "I agree to receive text messages from DropQ related to my account, orders, payments, " +
  "pickups, and activity on the DropQ platform. Message frequency varies. Message and data " +
  "rates may apply. Reply STOP to opt out or HELP for help. Consent is not required to " +
  "create an account or make a purchase. See Terms and Privacy Policy.";

export const MARKETING_DISCLOSURE =
  "I'd also like to receive text alerts from DropQ about vendors, drops, and products I " +
  "choose to follow. Message frequency varies. Message and data rates may apply. Reply STOP " +
  "to opt out or HELP for help. See Terms and Privacy Policy.";

/** Where a consent was captured. Stored verbatim for the audit trail. */
export type ConsentSource =
  | "checkout"
  | "waitlist"
  | "account_settings"
  | "sms_page"
  | "admin"
  | "import";

/**
 * What a given message is. The send gate maps this to the consent required.
 *
 * `security` covers verification codes. DropQ has no OTP flow today, but the
 * category exists so that if one is added it is never gated behind a marketing
 * opt-in, and never silently reclassified as promotional.
 */
export type SmsKind = "transactional" | "marketing" | "security" | "operational";

/** Which consent flag a message kind requires. */
export function consentRequiredFor(kind: SmsKind): "transactional" | "marketing" | null {
  switch (kind) {
    case "marketing":
      return "marketing";
    case "transactional":
      return "transactional";
    // Security codes are user-initiated and exempt. `operational` covers
    // internal/B2B sends (sales-rep invites, the admin test button) that never
    // go to a customer.
    case "security":
    case "operational":
      return null;
  }
}

export const HELP_REPLY =
  "DropQ: order and drop notifications. Help: support@drop-q.com or https://www.drop-q.com/sms " +
  "Reply STOP to unsubscribe. Msg&data rates may apply.";

export const STOP_REPLY =
  "DropQ: You've been unsubscribed and won't receive further texts. " +
  "Reply START to resubscribe. Help: support@drop-q.com";
