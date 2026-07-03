import Link from "next/link";
import { Logo } from "@/components/logo";
import { TERMS_VERSION, TERMS_EFFECTIVE } from "@/lib/terms";

export const metadata = { title: "Vendor Agreement & Terms — DropQ" };

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

export default function TermsPage() {
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
          DropQ Vendor Agreement &amp; Terms of Service
        </h1>
        <p className="text-muted mt-2">
          Version {TERMS_VERSION} · Effective {TERMS_EFFECTIVE}
        </p>

        <p className="mt-6 text-[0.95rem] leading-relaxed text-ink-soft">
          This Vendor Agreement and Terms of Service (the &ldquo;Agreement&rdquo;) is a
          binding contract between you, the vendor (&ldquo;Vendor,&rdquo; &ldquo;you,&rdquo;
          or &ldquo;your&rdquo;), and <b>DropQ LLC</b> (&ldquo;DropQ,&rdquo; &ldquo;we,&rdquo;
          &ldquo;us,&rdquo; or &ldquo;our&rdquo;). By checking the acceptance box, creating a
          store, or otherwise using the DropQ platform, you agree to be bound by this Agreement.
          If you do not agree, do not use the platform.
        </p>

        <Section n="1" title="The DropQ Platform">
          <p>
            DropQ provides software and online tools that allow independent food sellers to list
            products, run timed &ldquo;drops,&rdquo; accept orders, and collect payment
            (the &ldquo;Platform&rdquo;). <b>DropQ is a technology provider only.</b> DropQ does
            not make, prepare, handle, store, inspect, package, sell, deliver, or take title to
            any food or other products offered by Vendors. DropQ is not the seller, manufacturer,
            distributor, or merchant of any Vendor product.
          </p>
        </Section>

        <Section n="2" title="Independent Relationship">
          <p>
            You are an independent business. Nothing in this Agreement creates any employment,
            agency, partnership, joint venture, or franchise relationship between you and DropQ.
            You have no authority to bind DropQ, and DropQ has no authority to bind you. You are
            solely responsible for how you operate your business.
          </p>
        </Section>

        <Section n="3" title="Your Responsibilities">
          <p>You are solely and exclusively responsible for, and represent and warrant that you will:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              comply with all applicable laws, regulations, and ordinances, including all food
              safety, cottage food, health, labeling, allergen, weights-and-measures, and consumer
              protection laws;
            </li>
            <li>obtain and maintain all licenses, permits, registrations, and insurance required for your business;</li>
            <li>ensure the safety, quality, accuracy, and legality of every product you list, prepare, and deliver;</li>
            <li>accurately describe your products, including ingredients, allergens, pricing, pickup/delivery terms, and availability;</li>
            <li>fulfill orders, provide customer service, and handle your own refunds, cancellations, and disputes with your customers;</li>
            <li>collect, report, and remit all applicable taxes; and</li>
            <li>handle your customers&rsquo; personal information in compliance with applicable privacy laws.</li>
          </ul>
        </Section>

        <Section n="4" title="Product Quality, Safety &amp; Conduct">
          <p>
            <b>The quality, safety, and fitness of your products, and all of your conduct, are
            entirely your responsibility.</b> DropQ does not and cannot guarantee, verify, or
            assume responsibility for any Vendor, any Vendor&rsquo;s products, or anything a Vendor
            does or delivers. Any illness, injury, allergic reaction, damage, dissatisfaction,
            misrepresentation, or other harm arising from your products or conduct is your sole
            responsibility, and you assume all risk and liability for it.
          </p>
        </Section>

        <Section n="5" title="Payments &amp; Fees">
          <p>
            Payments are processed by third-party payment processors (e.g., Stripe). Your use of
            those services is subject to their terms. Funds from sales are paid to your connected
            payment account; DropQ is not a bank, payment processor, escrow agent, or party to the
            transaction between you and your customer. DropQ charges a platform fee (currently 2%
            per transaction), and standard payment-processing fees may apply. You are responsible
            for all refunds, chargebacks, reversals, and disputes relating to your sales.
          </p>
        </Section>

        <Section n="6" title="Disclaimer of Warranties">
          <p>
            THE PLATFORM IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT
            WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED
            WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
            NON-INFRINGEMENT. DROPQ DOES NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED,
            ERROR-FREE, OR SECURE.
          </p>
        </Section>

        <Section n="7" title="Limitation of Liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, DROPQ LLC AND ITS OWNERS, OFFICERS, EMPLOYEES,
            AND AGENTS WILL NOT BE LIABLE TO YOU OR TO ANY THIRD PARTY FOR ANY CLAIM, LOSS, INJURY,
            ILLNESS, OR DAMAGES OF ANY KIND ARISING OUT OF OR RELATED TO (a) YOUR PRODUCTS,
            (b) YOUR ACTS, OMISSIONS, OR CONDUCT, (c) ANYTHING YOU SELL, PREPARE, OR DELIVER, OR
            (d) ANY DISPUTE BETWEEN YOU AND A CUSTOMER OR THIRD PARTY. DROPQ WILL NOT BE LIABLE FOR
            ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR
            FOR LOST PROFITS OR REVENUES. IN ALL CASES, DROPQ&rsquo;S TOTAL AGGREGATE LIABILITY TO
            YOU FOR ANY CLAIM ARISING UNDER THIS AGREEMENT WILL NOT EXCEED THE GREATER OF (i) THE
            TOTAL PLATFORM FEES YOU PAID TO DROPQ IN THE THREE (3) MONTHS PRECEDING THE CLAIM, OR
            (ii) ONE HUNDRED U.S. DOLLARS ($100).
          </p>
        </Section>

        <Section n="8" title="Indemnification">
          <p>
            You agree to defend, indemnify, and hold harmless DropQ LLC and its owners, officers,
            employees, and agents from and against any and all claims, demands, liabilities,
            damages, losses, costs, and expenses (including reasonable attorneys&rsquo; fees)
            arising out of or related to: (a) your products; (b) your acts, omissions, or conduct;
            (c) your violation of any law or of this Agreement; (d) any harm, injury, or illness
            connected to anything you sell or deliver; or (e) any dispute between you and a
            customer or other third party.
          </p>
        </Section>

        <Section n="9" title="Your Customers">
          <p>
            Every sale is a transaction solely between you and your customer. DropQ is not a party
            to it. You are responsible for your relationship with your customers, including order
            fulfillment, communications, refunds, and resolution of any complaint or dispute.
          </p>
        </Section>

        <Section n="10" title="Prohibited &amp; Illegal Products; Account Bans">
          <p>
            You must comply with all applicable federal, state, and local laws at all times. You
            may <b>not</b> create a DropQ store, run a drop, or use the Platform to offer, list,
            sell, or deliver any product or service that is illegal, restricted, or prohibited
            under the laws of the state and locality where you operate, prepare, or fulfill orders.
            This includes, without limitation: controlled substances and cannabis, THC, or CBD
            products where prohibited; alcohol, tobacco, or vaping products sold without the
            required license; any food or other good that requires a permit, license, registration,
            or inspection you do not hold (including applicable cottage-food, food-handler, and
            health-department requirements); weapons; and recalled, counterfeit, stolen, unsafe, or
            otherwise unlawful items.
          </p>
          <p>
            You may also not use the Platform to deceive customers, misrepresent your products,
            infringe others&rsquo; rights, or otherwise violate any law or this Agreement.
            <b> Determining which laws apply to you and complying with them is your sole
            responsibility.</b>
          </p>
          <p>
            If DropQ believes, in its sole discretion, that you have violated this Section or any
            other part of this Agreement, DropQ may immediately suspend, remove, or
            <b> permanently ban</b> your store, drops, and account from the Platform, withhold or
            reverse affected payouts, and report unlawful activity to the appropriate authorities —
            with or without prior notice, and in addition to any other rights or remedies available
            to DropQ.
          </p>
        </Section>

        <Section n="11" title="Content License">
          <p>
            You retain ownership of the content you upload (store name, descriptions, photos). You
            grant DropQ a non-exclusive, royalty-free license to host, display, and use that
            content solely to operate and promote the Platform and your storefront. You represent
            that you have the rights to all content you upload.
          </p>
        </Section>

        <Section n="12" title="Term &amp; Termination">
          <p>
            This Agreement applies for as long as you use the Platform. You may stop using the
            Platform at any time. DropQ may suspend or terminate your access at any time, with or
            without cause. Sections that by their nature should survive termination (including
            Disclaimer, Limitation of Liability, and Indemnification) will survive.
          </p>
        </Section>

        <Section n="13" title="Changes to This Agreement">
          <p>
            DropQ may update this Agreement from time to time. If we make material changes, we may
            require you to review and accept the updated Agreement before continuing to use the
            Platform. Your continued use after an update constitutes acceptance.
          </p>
        </Section>

        <Section n="14" title="Governing Law &amp; Disputes">
          <p>
            This Agreement is governed by the laws of the State of [STATE], without regard to its
            conflict-of-laws rules. Any dispute will be resolved in the state or federal courts
            located in [COUNTY/STATE], and you consent to that jurisdiction.
          </p>
        </Section>

        <Section n="15" title="General">
          <p>
            If any provision of this Agreement is found unenforceable, the remaining provisions
            stay in effect. This Agreement is the entire agreement between you and DropQ regarding
            the Platform. DropQ&rsquo;s failure to enforce a provision is not a waiver.
          </p>
        </Section>

        <Section n="16" title="Contact">
          <p>
            Questions about this Agreement:{" "}
            <a href="mailto:dropqteam@gmail.com" className="text-brand hover:underline">dropqteam@gmail.com</a>.
          </p>
        </Section>

        <div className="mt-10 rounded-card border border-line bg-paper p-5 text-sm text-muted">
          By creating a store on DropQ, you acknowledge that you have read, understood, and agree
          to this Vendor Agreement &amp; Terms of Service (Version {TERMS_VERSION}).
        </div>

        <div className="mt-8">
          <Link href="/signup" className="text-brand font-medium hover:underline">
            ← Back to sign up
          </Link>
        </div>
      </article>
    </main>
  );
}
