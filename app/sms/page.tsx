import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { TRANSACTIONAL_DISCLOSURE, MARKETING_DISCLOSURE } from "@/lib/sms-consent";

export const metadata: Metadata = {
  title: "SMS Messaging — DropQ",
  description:
    "How DropQ text messaging works: what messages we send, how to opt in and out, message frequency, and rates.",
  alternates: { canonical: "https://www.drop-q.com/sms" },
};

/**
 * Public SMS information page. Reachable without an account — this is the URL
 * a carrier or Twilio reviewer visits to verify the call to action.
 *
 * It documents the real consent flow and reproduces the exact checkbox copy
 * used in the product, rendered from the same constants the forms use, so this
 * page cannot drift out of sync with what customers actually see.
 */
export default function SmsPage() {
  return (
    <>
      <SiteNav />
      <main className="max-w-3xl mx-auto px-5 py-12 sm:py-16">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
          DropQ SMS Messaging
        </h1>

        <div className="mt-6 space-y-4 text-ink-soft leading-relaxed">
          <p>
            DropQ customers may choose to receive text messages related to account activity,
            orders, payments, pickups, and other activity on the DropQ platform.
          </p>
          <p>
            Users may also separately choose to receive notifications about vendors or drops they
            follow.
          </p>
        </div>

        <ul className="mt-6 space-y-2 text-ink-soft">
          {[
            "Message frequency varies.",
            "Message and data rates may apply.",
            "Reply STOP to unsubscribe.",
            "Reply HELP for assistance.",
            "SMS consent is optional and is not a condition of purchase or account creation.",
          ].map((line) => (
            <li key={line} className="flex gap-2.5">
              <span className="text-brand shrink-0" aria-hidden>
                •
              </span>
              {line}
            </li>
          ))}
        </ul>

        {/* The actual consent UI, so a reviewer can verify the CTA without
            needing an account or reaching a vendor's checkout. */}
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">How you opt in</h2>
          <p className="text-muted mt-2">
            DropQ never pre-checks these boxes and never enrols you automatically. Providing a
            phone number, creating an account, accepting our Terms, or completing a purchase does
            not opt you in. These are the exact checkboxes shown in the product:
          </p>

          <div className="mt-5 bg-paper border border-line rounded-card p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Shown at checkout, and in account settings
            </p>
            <label className="flex items-start gap-2.5 mt-3 text-sm text-ink-soft">
              <input type="checkbox" disabled className="mt-0.5 w-4 h-4 shrink-0" />
              <span className="text-xs leading-snug">
                {TRANSACTIONAL_DISCLOSURE.replace(" See Terms and Privacy Policy.", " See ")}
                <Link href="/terms" className="underline">
                  Terms
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="underline">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
          </div>

          <div className="mt-4 bg-paper border border-line rounded-card p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Shown when following a vendor, and in account settings
            </p>
            <label className="flex items-start gap-2.5 mt-3 text-sm text-ink-soft">
              <input type="checkbox" disabled className="mt-0.5 w-4 h-4 shrink-0" />
              <span className="text-xs leading-snug">
                {MARKETING_DISCLOSURE.replace(" See Terms and Privacy Policy.", " See ")}
                <Link href="/terms" className="underline">
                  Terms
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="underline">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
          </div>

          <p className="text-xs text-muted mt-3">
            The checkboxes above are a copy of the live consent UI, shown here for reference. They
            are disabled on this page — opting in happens at checkout or in your account settings.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Opting out</h2>
          <p className="text-ink-soft mt-2 leading-relaxed">
            Reply <b>STOP</b> to any DropQ text to unsubscribe. You&apos;ll get one confirmation
            message and nothing after that. Reply <b>START</b> to resubscribe, or <b>HELP</b> for
            assistance. You can also change your preferences any time in your DropQ account
            settings.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Your information</h2>
          <p className="text-ink-soft mt-2 leading-relaxed">
            Mobile information and text messaging opt-in data and consent will not be shared with
            third parties or affiliates for marketing or promotional purposes. DropQ operates the
            messaging system on vendors&apos; behalf and honours your consent preferences on every
            send — vendors do not receive your consent data to market to you independently.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Help</h2>
          <p className="text-ink-soft mt-2 leading-relaxed">
            Email{" "}
            <a href="mailto:support@drop-q.com" className="text-brand hover:underline">
              support@drop-q.com
            </a>
            . See our{" "}
            <Link href="/terms" className="text-brand hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-brand hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
