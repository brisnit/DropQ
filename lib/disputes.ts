import "server-only";
import { sendEmail } from "@/lib/email";
import { formatMoney } from "@/lib/format";

/**
 * Alert DropQ staff when a vendor is disputed.
 *
 * Under direct charges the money comes out of the *vendor's* balance, so this
 * is an operational signal rather than a financial one: DropQ should know a
 * vendor is being disputed (fraud pattern, fulfilment problem, a store worth
 * reviewing) even though it isn't DropQ's money at risk.
 *
 * Deliberately no database model yet — a Dispute table is only worth building
 * if disputes become common enough to need a queue. Logging plus an email is
 * the honest amount of machinery for the current volume.
 */
export async function notifyAdminsOfDispute(d: {
  disputeId: string;
  reason: string;
  amountCents: number;
  storeName: string | null;
  vendorEmail: string | null;
  orderId: string | null;
  buyerName: string | null;
}): Promise<void> {
  const admins = (process.env.DROPQ_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (admins.length === 0) return;

  const rows = [
    ["Vendor", d.storeName ?? "unknown"],
    ["Vendor email", d.vendorEmail ?? "—"],
    ["Amount", formatMoney(d.amountCents)],
    ["Reason", d.reason],
    ["Order", d.orderId ?? "could not match"],
    ["Buyer", d.buyerName ?? "—"],
    ["Stripe dispute", d.disputeId],
  ]
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6d6f71">${k}</td><td>${v}</td></tr>`)
    .join("");

  await Promise.allSettled(
    admins.map((to) =>
      sendEmail({
        to,
        subject: `⚠️ Chargeback on DropQ — ${d.storeName ?? "unknown vendor"} (${formatMoney(d.amountCents)})`,
        html:
          `<div style="font-family:sans-serif;color:#1a1a1a">` +
          `<h2 style="margin:0 0 12px">Chargeback opened</h2>` +
          `<p style="color:#3d3d3d;margin:0 0 16px">Funds come from the vendor's Stripe balance ` +
          `(direct charges) — DropQ is not liable. The vendor must submit evidence in Stripe.</p>` +
          `<table style="font-size:14px">${rows}</table></div>`,
      })
    )
  );
}
