import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Privacy Policy — DropQ" };

const EFFECTIVE = "June 25, 2026";

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="font-display text-xl font-semibold tracking-tight">
        {n}. {title}
      </h2>
      <div className="mt-2 space-y-3 text-[0.95rem] leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-cream/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-5 h-16 flex items-center justify-between">
          <Logo href="/" />
          <Link href="/signup" className="text-sm font-medium text-brand hover:underline">
            Start selling →
          </Link>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-5 py-10">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
          DropQ Privacy Policy
        </h1>
        <p className="text-muted mt-2">Effective {EFFECTIVE}</p>

        <p className="mt-6 text-[0.95rem] leading-relaxed text-ink-soft">
          This Privacy Policy explains how <b>DropQ LLC</b> (&ldquo;DropQ,&rdquo; &ldquo;we,&rdquo;
          &ldquo;us,&rdquo; or &ldquo;our&rdquo;) collects, uses, shares, and protects information
          when you use the DropQ platform, websites, and related services (the &ldquo;Services&rdquo;).
          It applies to <b>vendors</b> who create stores, <b>customers</b> who place orders, and{" "}
          <b>sales representatives</b> in our referral program. By using the Services, you agree to
          this Policy.
        </p>

        <Section n="1" title="Information We Collect">
          <p>We collect the following categories of information:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <b>Account information.</b> When a vendor or sales rep creates an account, we collect
              name, email address, password (stored hashed), and phone number.
            </li>
            <li>
              <b>Store content.</b> Vendor store name, description, photos, location, social links,
              products, drops, and pricing.
            </li>
            <li>
              <b>Order &amp; customer information.</b> When a customer places an order, we collect
              their name, email address, phone number, order details, and any note they provide.
            </li>
            <li>
              <b>Payment information.</b> Payments are processed by <b>Stripe</b>. DropQ does not
              store full card numbers; card details are provided directly to Stripe and handled
              under Stripe&rsquo;s privacy policy.
            </li>
            <li>
              <b>Communications.</b> Email and SMS/text messages we send you about orders, drops,
              account activity, and (for reps) referral activity, plus your related preferences.
            </li>
            <li>
              <b>Usage &amp; device data.</b> Basic technical data such as IP address, browser type,
              pages viewed, and interactions, collected to operate and secure the Services.
            </li>
            <li>
              <b>Cookies.</b> We use a small number of essential cookies (for example, a signed
              session cookie to keep you logged in). See Section 6.
            </li>
          </ul>
        </Section>

        <Section n="2" title="How We Use Information">
          <p>We use information to:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>provide, operate, and improve the Services;</li>
            <li>create and manage vendor, customer, and sales-rep accounts;</li>
            <li>process orders and route payments through Stripe;</li>
            <li>
              send <b>transactional</b> messages by email and text — order confirmations, order
              status updates (in progress, ready, completed, canceled), refund notices, drop
              go-live and waitlist alerts, and account or referral notifications;
            </li>
            <li>attribute referred vendors to sales representatives and calculate commissions;</li>
            <li>provide customer support and respond to your requests;</li>
            <li>detect, prevent, and address fraud, abuse, and security issues; and</li>
            <li>comply with legal obligations and enforce our agreements.</li>
          </ul>
        </Section>

        <Section n="3" title="SMS / Text Messaging">
          <p>
            DropQ uses text messaging as a primary way to keep customers and users informed. By
            providing your mobile number and placing an order, joining a waitlist, or creating an
            account, you consent to receive <b>transactional and service-related SMS messages</b>{" "}
            from DropQ and the vendors you order from (for example: order confirmations, &ldquo;your
            order is ready&rdquo; alerts, refund notices, drop go-live alerts, and account or
            referral messages).
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Message frequency varies based on your activity (for example, per order or per drop).</li>
            <li>Message and data rates may apply, depending on your mobile carrier and plan.</li>
            <li>
              You can opt out at any time by replying <b>STOP</b> to any message; reply <b>HELP</b>{" "}
              for help. After you reply STOP, we will stop sending you non-essential texts.
            </li>
            <li>Carriers are not liable for delayed or undelivered messages.</li>
          </ul>
          <p>
            <b>
              We do not sell or share your mobile phone number or SMS opt-in/consent for marketing
              or promotional purposes with third parties.
            </b>{" "}
            Your number is used only to deliver the Services (including through our messaging
            provider, Twilio) and to enable the vendor you interact with to communicate about your
            order.
          </p>
        </Section>

        <Section n="4" title="How We Share Information">
          <p>We share information only as needed to run the Services:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <b>With vendors.</b> When you order from a store, the vendor receives your order
              details and contact information so they can fulfill your order and provide support.
            </li>
            <li>
              <b>Service providers.</b> We use trusted providers to operate the Services, including{" "}
              <b>Stripe</b> (payments), <b>Twilio</b> (SMS), <b>Resend</b> (email), and our hosting
              and infrastructure providers. They may process information only to provide services to
              us and are bound to protect it.
            </li>
            <li>
              <b>Sales representatives.</b> If you sign up through a rep&rsquo;s referral link, your
              store is attributed to that rep, who can see limited business activity (such as your
              store name, subscription status, and aggregate sales/commission) for commission
              reporting — not your customers&rsquo; personal details.
            </li>
            <li>
              <b>Legal &amp; safety.</b> We may disclose information if required by law, or to
              protect the rights, property, or safety of DropQ, our users, or the public.
            </li>
            <li>
              <b>Business transfers.</b> If DropQ is involved in a merger, acquisition, or sale of
              assets, information may be transferred as part of that transaction.
            </li>
          </ul>
          <p>We do not sell your personal information.</p>
        </Section>

        <Section n="5" title="Vendor Responsibilities">
          <p>
            Vendors receive their customers&rsquo; information to fulfill orders and are independent
            businesses responsible for handling that information in compliance with applicable
            privacy laws. DropQ is not responsible for a vendor&rsquo;s independent use of customer
            information outside the Services.
          </p>
        </Section>

        <Section n="6" title="Cookies &amp; Similar Technologies">
          <p>
            We use essential cookies to keep you signed in and to operate the Services securely. We
            do not use third-party advertising cookies. Most browsers let you control cookies, but
            disabling essential cookies may prevent you from logging in.
          </p>
        </Section>

        <Section n="7" title="Data Retention">
          <p>
            We retain information for as long as your account is active or as needed to provide the
            Services, comply with legal, tax, and accounting obligations, resolve disputes, and
            enforce our agreements. We may retain certain records (such as order and commission
            history) as required for those purposes.
          </p>
        </Section>

        <Section n="8" title="Security">
          <p>
            We use reasonable technical and organizational measures to protect information, including
            encrypted connections and hashed passwords. No method of transmission or storage is
            completely secure, and we cannot guarantee absolute security.
          </p>
        </Section>

        <Section n="9" title="Your Choices &amp; Rights">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <b>Access &amp; correction.</b> You can view and update your account and store
              information from your dashboard, or by contacting us.
            </li>
            <li>
              <b>Deletion.</b> You may request deletion of your account and associated personal
              information, subject to records we must retain by law.
            </li>
            <li>
              <b>Email.</b> Transactional emails are part of the Services; where we offer optional
              messages, you can adjust preferences or unsubscribe.
            </li>
            <li>
              <b>SMS.</b> Reply <b>STOP</b> to opt out of texts at any time (see Section 3).
            </li>
          </ul>
          <p>
            Depending on where you live, you may have additional rights under applicable privacy
            laws. To exercise any right, contact us using the details below.
          </p>
        </Section>

        <Section n="10" title="Third-Party Services">
          <p>
            The Services rely on and may link to third parties (such as Stripe, Twilio, and Resend).
            Their handling of information is governed by their own privacy policies, and we encourage
            you to review them. We are not responsible for the privacy practices of third parties.
          </p>
        </Section>

        <Section n="11" title="Children&rsquo;s Privacy">
          <p>
            The Services are not directed to children under 13 (or the minimum age required in your
            jurisdiction), and we do not knowingly collect their personal information. If you believe
            a child has provided us information, please contact us and we will delete it.
          </p>
        </Section>

        <Section n="12" title="Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. When we make material changes, we
            will update the &ldquo;Effective&rdquo; date above and, where appropriate, provide
            additional notice. Your continued use of the Services after an update constitutes
            acceptance of the revised Policy.
          </p>
        </Section>

        <Section n="13" title="Contact Us">
          <p>
            Questions or requests regarding this Privacy Policy or your information:{" "}
            <a href="mailto:dropqteam@gmail.com" className="text-brand hover:underline">dropqteam@gmail.com</a>.
          </p>
        </Section>

        <div className="mt-10 flex flex-wrap gap-4">
          <Link href="/" className="text-brand font-medium hover:underline">← Back to DropQ</Link>
          <Link href="/terms" className="text-muted hover:text-ink">Vendor Terms →</Link>
        </div>
      </article>
    </main>
  );
}
