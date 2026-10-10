import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findLocationDuplicates } from "@/lib/dropmeet/dedupe";
import {
  approveLocationAction,
  rejectLocationAction,
  unpublishLocationAction,
  deleteLocationAction,
  locationImpact,
} from "@/lib/actions/dropmeet";
import { AdminEditLocationForm } from "@/components/dropmeet/admin-edit-location";
import { PageHeader, Section } from "@/components/dashboard-ui";
import { createMapsUrl } from "@/lib/maps";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review place — DropQ Admin" };

/** Correct a submission before it goes live. Admins may edit anything. */
export default async function AdminEditLocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ delete?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const impact = await locationImpact(id);

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

      {/* Taking a place down. Unpublish first, delete only if it should never
          have existed — the two are not the same and the page should not make
          them look it. */}
      <div className="mt-10 pt-6 border-t border-line">
        <h2 className="font-semibold">Take this place down</h2>

        {loc.status === "approved" && (
          <form action={unpublishLocationAction} className="mt-3">
            <input type="hidden" name="id" value={loc.id} />
            <button className="inline-flex items-center min-h-11 px-5 rounded-pill border border-line-strong text-sm font-semibold hover:border-ink/30 transition">
              Unpublish — hide from the map
            </button>
            <p className="text-xs text-muted mt-1.5 max-w-prose">
              Reversible. It stops being public immediately and goes back to the
              pending queue. Markets, events and vendor appearances are kept.
            </p>
          </form>
        )}

        {impact.appearances > 0 ? (
          /* Deletion is refused, so the page must not show a delete form that
             cannot work. It shows the reason and the thing to do instead. */
          <div className="mt-6 rounded-card border border-line-strong bg-cream p-4 max-w-prose">
            <h3 className="text-sm font-semibold">
              Permanent deletion isn&apos;t available for this place
            </h3>
            <p className="text-sm text-ink-soft mt-2">
              <b>
                {impact.appearances} vendor appearance
                {impact.appearances === 1 ? "" : "s"}
              </b>{" "}
              {impact.appearances === 1 ? "is" : "are"} attached
              {impact.marketAppearances > 0 &&
                ` (${impact.directAppearances} at the place itself, ${impact.marketAppearances} at ${impact.markets === 1 ? "its market" : "its markets"})`}
              . {impact.appearances === 1 ? "A vendor has" : "Vendors have"}{" "}
              published that they&apos;ll be here, and deleting the place would
              erase {impact.appearances === 1 ? "that plan" : "those plans"}{" "}
              without telling {impact.appearances === 1 ? "them" : "them"}.
            </p>
            {loc.status === "approved" ? (
              <p className="text-sm mt-3">
                Unpublish it instead — that hides it from the map and search
                straight away and keeps every appearance intact.
              </p>
            ) : (
              <p className="text-sm mt-3">
                It is already not public, so there is nothing more to hide.
              </p>
            )}
            <p className="text-xs text-muted mt-3">
              If this place genuinely should never have existed, the vendors
              need to cancel their appearances first — then deletion unlocks.
            </p>
          </div>
        ) : (
        <details className="mt-6 group">
          <summary className="inline-flex items-center min-h-11 text-sm font-medium text-brand-dark cursor-pointer select-none">
            Delete permanently…
          </summary>

          <div className="mt-3 rounded-card border border-brand/40 bg-brand-tint/30 p-4 max-w-prose">
            {sp.delete === "name_mismatch" && (
              <p className="text-sm text-brand-dark mb-3">
                The name didn&apos;t match, so nothing was deleted. Type it exactly.
              </p>
            )}
            {sp.delete === "needs_ack" && (
              <p className="text-sm text-brand-dark mb-3">
                This place has things attached — tick the box to confirm you
                understand what goes with it.
              </p>
            )}
            {sp.delete === "blocked_appearances" && (
              <p className="text-sm text-brand-dark mb-3">
                Nothing was deleted — vendor appearances were attached.
              </p>
            )}

            <p className="text-sm">
              This cannot be undone. Deleting <b>{loc.name}</b> also deletes
              what is attached to it:
            </p>
            <ul className="text-sm mt-2 space-y-0.5">
              <li>{impact.markets} market{impact.markets === 1 ? "" : "s"}</li>
              <li>{impact.follows} follower{impact.follows === 1 ? "" : "s"}</li>
              <li>{impact.claims} claim{impact.claims === 1 ? "" : "s"}</li>
              <li>
                no vendor appearances — deletion is blocked while any exist
              </li>
            </ul>
            {impact.events > 0 && (
              /* Event.locationId is SetNull: the event survives and keeps its
                 own coordinates. Saying "deleted" here would be a lie. */
              <p className="text-sm mt-2">
                {impact.events} event{impact.events === 1 ? "" : "s"} here{" "}
                {impact.events === 1 ? "will keep" : "will keep"} existing but
                lose {impact.events === 1 ? "its" : "their"} venue.
              </p>
            )}

            {impact.total > 0 && (
              <p className="text-sm font-medium mt-3">
                Unpublishing is almost certainly what you want instead.
              </p>
            )}

            <form action={deleteLocationAction} className="mt-4 space-y-3">
              <input type="hidden" name="id" value={loc.id} />
              <label className="block">
                <span className="block text-xs font-medium text-ink-soft mb-1">
                  Type the name to confirm: <b>{loc.name}</b>
                </span>
                <input
                  name="confirmName"
                  required
                  autoComplete="off"
                  className="w-full min-w-0 bg-paper border border-line-strong rounded-xl px-3 py-2.5 text-sm"
                />
              </label>
              {impact.total > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="acknowledgeImpact" value="1" required className="mt-1" />
                  <span>
                    I understand {impact.total} attached record
                    {impact.total === 1 ? "" : "s"} will be affected too.
                  </span>
                </label>
              )}
              <button className="inline-flex items-center min-h-11 px-5 rounded-pill bg-brand text-white text-sm font-semibold hover:bg-brand-dark transition">
                Delete this place
              </button>
            </form>
          </div>
        </details>
        )}
      </div>
    </Section>
  );
}
