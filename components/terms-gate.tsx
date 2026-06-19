import Link from "next/link";
import { Logo } from "@/components/logo";
import { TermsSubmitButton } from "@/components/terms-submit-button";
import { TERMS_VERSION } from "@/lib/terms";

// Server component so the form is fully server-rendered (works with and without
// JS). The action is passed in from the dashboard layout.
export function TermsGate({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="min-h-screen grid place-items-center px-5 py-10 bg-cream">
      <div className="w-full max-w-lg">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <div className="bg-paper border border-line rounded-card p-7 sm:p-8 shadow-[var(--shadow-soft)]">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            One quick thing before you sell
          </h1>
          <p className="text-muted mt-2 text-sm">
            To keep using DropQ, please review and accept our Vendor Agreement. It confirms that
            <b className="text-ink"> you — not DropQ — are responsible</b> for your products,
            conduct, and deliveries.
          </p>

          <ul className="mt-4 rounded-xl border border-line bg-cream/50 p-4 text-sm text-ink-soft space-y-2 list-disc pl-8">
            <li>You&rsquo;re an independent business; DropQ is just the software.</li>
            <li>You&rsquo;re solely responsible for product quality, safety, and legal compliance.</li>
            <li>DropQ LLC disclaims liability for your products, conduct, and customer disputes.</li>
            <li>You agree to indemnify DropQ for claims arising from what you sell or deliver.</li>
          </ul>

          <Link
            href="/terms"
            target="_blank"
            className="inline-block mt-3 text-sm text-brand font-medium hover:underline"
          >
            Read the full Vendor Agreement &amp; Terms ↗
          </Link>

          <form action={action} className="mt-5 space-y-4">
            <label className="flex items-start gap-2.5 text-sm text-ink-soft">
              <input type="checkbox" name="accept" required className="mt-0.5 w-4 h-4 accent-[#d25b2a] shrink-0" />
              <span>
                I have read and agree to the DropQ Vendor Agreement &amp; Terms (v{TERMS_VERSION}).
              </span>
            </label>
            <TermsSubmitButton />
          </form>
        </div>
      </div>
    </div>
  );
}
