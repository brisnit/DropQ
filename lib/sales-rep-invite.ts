import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail, salesRepInviteEmail } from "@/lib/email";
import { sendSms } from "@/lib/notifications";

function baseUrl() {
  return process.env.APP_URL?.replace(/\/$/, "") || "https://www.drop-q.com";
}

export type InviteResult = { emailOk: boolean; smsAttempted: boolean; smsOk: boolean };

/**
 * Send the sales-rep invite over email + SMS (best effort) and stamp
 * inviteSentAt. Email is the primary channel; SMS is sent only if a phone is on
 * file. Uses the existing providers (Resend email, Twilio SMS) — both no-op
 * with a dev log when their env vars aren't set. See lib/notifications.ts for
 * the SMS abstraction (TODO: Twilio A2P registration to send for real).
 */
export async function sendSalesRepInvite(repId: string): Promise<InviteResult> {
  const rep = await prisma.salesRep.findUnique({ where: { id: repId } });
  if (!rep) return { emailOk: false, smsAttempted: false, smsOk: false };

  const base = baseUrl();
  const signupUrl = `${base}/vendor/signup?ref=${rep.id}`;
  const accountUrl = `${base}/signup`;

  const emailRes = await sendEmail(
    salesRepInviteEmail({
      name: rep.name,
      email: rep.email,
      signupUrl,
      accountUrl,
    })
  );
  // `skipped` = no RESEND key (dev-logged) — treat as delivered in that mode.
  const emailOk = emailRes.ok || emailRes.skipped === true;

  let smsAttempted = false;
  let smsOk = false;
  if (rep.phone) {
    smsAttempted = true;
    try {
      await sendSms(
        rep.phone,
        `You've been invited to sell with DropQ. Share this vendor signup link: ${signupUrl}. ` +
          `Create your account with ${rep.email} to track referrals.`
      );
      smsOk = true; // sendSms logs/sends without throwing
    } catch {
      smsOk = false;
    }
  }

  await prisma.salesRep.update({ where: { id: rep.id }, data: { inviteSentAt: new Date() } });
  return { emailOk, smsAttempted, smsOk };
}
