import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findLocationDuplicates } from "@/lib/dropmeet/dedupe";
import { approveLocationAction, rejectLocationAction } from "@/lib/actions/dropmeet";
import { AdminEditLocationForm } from "@/components/dropmeet/admin-edit-location";
import { PageHeader, Section } from "@/components/dashboard-ui";
import { createMapsUrl } from "@/lib/maps";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review place — DropQ Admin" };

/** Correct a submission before it goes live. Admins may edit anything. */
export default async function AdminEditLocationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const loc = await prisma.location.findUnique({
    where: { id },
    include: {
      submittedBySeller: { select: { storeName: true, email: true } },
      submittedByCustomer: { select: { name: true, email: true } },
    },
  });
  if (!loc) notFound();

  const duplicates = await findLocationDuplicates(
    {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      address: loc.address,
      websiteUrl: loc.websiteUrl,
      phone: loc.phone,
    },
    loc.regionId,
    loc.id
  );

  const mapsUrl = createMapsUrl({ lat: loc.latitude, lng: loc.longitude });
  const submitter =
    loc.submittedBySeller?.storeName ??
    loc.submittedByCustomer?.name ??
    loc.submittedByCustomer?.email ??
    "Unknown";

  return (
    <Section>
      <PageHeader
        title={loc.name}
        subtitle={`Status: ${loc.status} · submitted by ${submitter} · source ${loc.sourceType}`}
        action={
          <Link href="/admin/dropmeet" className="text-sm font-medium text-ink-soft hover:text-ink">
            ← Queue
          </Link>
        }
      />

      {duplicates.length > 0 && (
        <div className="bg-quad-tint/40 border border-quad/30 rounded-card p-4 mb-6">
          <p className="text-sm font-semibold text-[#8a6a00]">Possible duplicates</p>
          <ul className="mt-2 space-y-1 text-sm">
            {duplicates.map((d) => (
              <li key={d.id}>
                <b>{d.name}</b>{" "}
                <span className="text-muted">
                  ({Math.round(d.score * 100)}% — {d.reasons.join(", ")})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mapsUrl && (
        <p className="text-sm mb-4">
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
            Open {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)} in Maps ↗
          </a>
        </p>
      )}

      <AdminEditLocationForm
        location={{
          id: loc.id,
          name: loc.name,
          locationType: loc.locationType,
          description: loc.description,
          address: loc.address,
          city: loc.city,
          state: loc.state,
          postalCode: loc.postalCode,
          latitude: loc.latitude,
          longitude: loc.longitude,
          websiteUrl: loc.websiteUrl,
          instagramUrl: loc.instagramUrl,
          phone: loc.phone,
          verificationStatus: loc.verificationStatus,
        }}
      />

      <div className="flex flex-wrap gap-2 mt-6">
        <form action={approveLocationAction}>
          <input type="hidden" name="id" value={loc.id} />
          <button className="inline-flex items-center min-h-[48px] px-6 rounded-pill bg-ink text-cream text-sm font-semibold">
            Approve and publish
          </button>
        </form>
        <form action={rejectLocationAction}>
          <input type="hidden" name="id" value={loc.id} />
          <input type="hidden" name="reason" value="Rejected in review" />
          <button className="inline-flex items-center min-h-[48px] px-6 rounded-pill border border-line-strong text-sm font-semibold text-brand-dark hover:bg-brand-tint transition">
            Reject
          </button>
        </form>
      </div>
      <p className="text-xs text-muted mt-2">
        Save your edits first — approving publishes whatever is currently stored.
      </p>
    </Section>
  );
}
