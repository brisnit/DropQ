"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCustomer } from "@/lib/customer-auth";
import { recordSmsConsent } from "@/lib/sms-gate";
import { DISCLOSURE_VERSION } from "@/lib/sms-consent";

export type AccountState = { saved?: boolean; error?: string };

/**
 * Progressive profile. Nothing here is required — a customer who only ever
 * gives an email keeps a working account. Email is deliberately NOT editable:
 * it's the identity key every order and magic link is bound to, so changing it
 * would orphan their history. Changing it needs a verify-both-addresses flow
 * that doesn't exist yet.
 */
export async function updateProfileAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const customer = await requireCustomer("/my/account");
  const name = String(formData.get("name") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;

  if (phone && phone.replace(/\D/g, "").length < 10) {
    return { error: "That mobile number doesn't look right." };
  }

  try {
    await prisma.customer.update({ where: { id: customer.id }, data: { name, phone } });
  } catch {
    return { error: "Couldn't save that. Please try again." };
  }

  revalidatePath("/my/account");
  return { saved: true };
}

/**
 * Notification preferences.
 *
 * SMS goes through recordSmsConsent so every change is stamped with when, from
 * where, and which disclosure version was on screen — the same audit trail
 * checkout writes. This page is a *capture* surface for the A2P consent system,
 * never a bypass of it:
 *
 *   • both SMS boxes are unchecked unless consent is genuinely on file
 *   • ticking one is an affirmative act, never inferred from anything else
 *   • transactional and marketing stay independent
 *   • a customer who replied STOP cannot be re-enabled from here — the carrier
 *     opt-out is authoritative and has to be cleared by replying START
 *
 * Email preferences are separate and unaffected by any of this.
 */
export async function updateNotificationsAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const customer = await requireCustomer("/my/account");

  const smsTransactional = formData.get("smsTransactional") === "on";
  const smsMarketing = formData.get("smsMarketing") === "on";

  // Honour the carrier-level opt-out above anything ticked in the UI.
  if (customer.smsOptedOutAt && (smsTransactional || smsMarketing)) {
    return {
      error:
        "You previously replied STOP to a DropQ text. To start receiving texts again, reply START to any DropQ message, then come back here.",
    };
  }

  if (!customer.phone && (smsTransactional || smsMarketing)) {
    return { error: "Add a mobile number above before turning on text messages." };
  }

  const saved = await recordSmsConsent({
    customerId: customer.id,
    transactional: smsTransactional,
    marketing: smsMarketing,
    source: "account_settings",
    disclosureVersion: DISCLOSURE_VERSION,
  });
  if (!saved) {
    return { error: "Couldn't save your preferences. Please try again." };
  }

  revalidatePath("/my/account");
  return { saved: true };
}
