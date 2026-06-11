import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { updateStoreAction } from "@/lib/actions/dashboard";
import { PageHeader, Section } from "@/components/dashboard-ui";
import { Button, Field, Input, Textarea } from "@/components/ui";

export const metadata = { title: "Store — DropQ" };

const ACCENTS = ["#6D28D9", "#3a8895", "#3F7D5B", "#8A2D52", "#2B6CB0", "#1C1916"];

export default async function StorePage() {
  const seller = await requireSeller();

  return (
    <Section>
      <PageHeader
        title="Store settings"
        subtitle="This is what buyers see on your storefront."
        action={
          <Link
            href={`/s/${seller.slug}`}
            target="_blank"
            className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            View storefront ↗
          </Link>
        }
      />

      <form action={updateStoreAction} className="bg-paper border border-line rounded-card p-6 sm:p-8 space-y-5 max-w-2xl">
        <Field label="Store name">
          <Input name="storeName" defaultValue={seller.storeName} required />
        </Field>

        <Field label="Store URL">
          <div className="flex items-center rounded-xl border border-line-strong bg-cream/60 px-3.5 py-2.5 text-muted">
            <span className="text-sm">dropq.com/s/</span>
            <span className="text-ink font-medium">{seller.slug}</span>
          </div>
        </Field>

        <Field label="Tagline" hint="One line under your name.">
          <Input name="tagline" defaultValue={seller.tagline ?? ""} placeholder="Small-batch cookies, baked Friday mornings." />
        </Field>

        <Field label="About" hint="Your story — buyers love knowing who they're supporting.">
          <Textarea name="bio" defaultValue={seller.bio ?? ""} placeholder="Tell customers about your food and your business." />
        </Field>

        <Field label="Location">
          <Input name="location" defaultValue={seller.location ?? ""} placeholder="Austin, TX" />
        </Field>

        <Field label="Brand accent" hint="Used across your storefront.">
          <div className="flex gap-3 flex-wrap">
            {ACCENTS.map((c) => (
              <label key={c} className="cursor-pointer">
                <input
                  type="radio"
                  name="accent"
                  value={c}
                  defaultChecked={seller.accent.toUpperCase() === c.toUpperCase()}
                  className="peer sr-only"
                />
                <span
                  className="block w-9 h-9 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-paper peer-checked:ring-ink transition"
                  style={{ backgroundColor: c }}
                />
              </label>
            ))}
          </div>
        </Field>

        <div className="pt-2">
          <Button type="submit">Save changes</Button>
        </div>
      </form>
    </Section>
  );
}
