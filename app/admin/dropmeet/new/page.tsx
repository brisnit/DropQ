import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { activeRegion } from "@/lib/dropmeet/geo";
import { AdminPlaceForm } from "@/components/dropmeet/admin-place-form";
import { PageHeader, Section } from "@/components/dashboard-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a place — DropQ Admin" };

export default async function AdminNewPlacePage() {
  await requireAdmin();
  const region = await activeRegion();

  return (
    <Section>
      <PageHeader
        title="Add a place"
        subtitle={
          region
            ? `Publishes immediately to ${region.name}. Use this for places you've verified yourself.`
            : "No active region — run npm run db:seed-region first."
        }
        action={
          <Link href="/admin/dropmeet" className="text-sm font-medium text-ink-soft hover:text-ink">
            ← Moderation queue
          </Link>
        }
      />
      {region ? (
        <AdminPlaceForm />
      ) : (
        <div className="bg-paper border border-dashed border-line-strong rounded-card p-8 text-center text-muted">
          Seed the San Diego County region before adding places.
        </div>
      )}
    </Section>
  );
}
