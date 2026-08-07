import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activeRegion } from "@/lib/dropmeet/geo";
import { findLocationDuplicates } from "@/lib/dropmeet/dedupe";
import {
  approveLocationAction,
  rejectLocationAction,
  approveMarketAction,
  rejectMarketAction,
  reviewClaimAction,
} from "@/lib/actions/dropmeet";
import { locationTypeLabel, marketTypeLabel } from "@/lib/dropmeet/types";
import { PageHeader, Section } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";
import { createMapsUrl } from "@/lib/maps";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "DropMeet moderation — DropQ Admin" };

/**
 * The DropMeet moderation queue. This is the only door between a community
 * submission and the public map — every action here is admin-gated server-side
 * in lib/actions/dropmeet.ts, not merely hidden from the UI.
 */
export default async function DropMeetAdminPage() {
  await requireAdmin();
  const region = await activeRegion();

  const [pendingLocations, pendingMarkets, claims, candidates, leads, approvedCount] =
    await Promise.all([
      prisma.location.findMany({
        where: { status: { in: ["pending", "needs_information"] } },
        orderBy: { createdAt: "asc" },
        take: 40,
        include: {
          submittedBySeller: { select: { storeName: true, email: true } },
          submittedByCustomer: { select: { name: true, email: true } },
        },
      }),
      prisma.market.findMany({
        where: { status: { in: ["pending", "needs_information"] } },
        orderBy: { createdAt: "asc" },
        take: 40,
        include: {
          location: { select: { name: true, address: true, city: true, status: true } },
          schedules: true,
          submittedBySeller: { select: { storeName: true } },
          submittedByCustomer: { select: { name: true, email: true } },
        },
      }),
      prisma.claimRequest.findMany({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
        take: 20,
        include: {
          location: { select: { name: true, slug: true } },
          market: { select: { name: true, slug: true } },
        },
      }),
      prisma.dropMeetCandidate.count({ where: { status: { in: ["pending", "needs_review"] } } }),
      prisma.vendorLead.count({ where: { status: "new" } }),
      prisma.location.count({ where: { status: "approved" } }),
    ]);

  // Duplicate suggestions computed per pending row so the reviewer sees them
  // before approving, not after.
  const duplicateMap = new Map<string, Awaited<ReturnType<typeof findLocationDuplicates>>>();
  for (const loc of pendingLocations) {
    duplicateMap.set(
      loc.id,
      await findLocationDuplicates(
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
      )
    );
  }

  return (
    <Section>
      <PageHeader
        title="DropMeet moderation"
        subtitle={
          region
            ? `${region.name} · ${approvedCount} approved place${approvedCount === 1 ? "" : "s"} live`
            : "No region is active — run npm run db:seed-region"
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7">
        <Tile label="Pending places" value={pendingLocations.length} />
        <Tile label="Pending markets" value={pendingMarkets.length} />
        <Tile label="Claims" value={claims.length} />
        <Tile label="Import candidates" value={candidates} />
      </div>

      {leads > 0 && (
        <p className="text-sm text-muted mb-6">
          {leads} vendor lead{leads === 1 ? "" : "s"} waiting from “Invite a vendor”.
        </p>
      )}

      {/* ── Pending locations ────────────────────────────────────────────── */}
      <h2 className="font-display text-lg font-semibold mb-3">Pending places</h2>
      {pendingLocations.length === 0 ? (
        <Empty>Nothing waiting. New community submissions land here.</Empty>
      ) : (
        <ul className="space-y-4 mb-10">
          {pendingLocations.map((loc) => {
            const dupes = duplicateMap.get(loc.id) ?? [];
            const submitter =
              loc.submittedBySeller?.storeName ??
              loc.submittedByCustomer?.name ??
              loc.submittedByCustomer?.email ??
              "Unknown";
            const mapsUrl = createMapsUrl({ lat: loc.latitude, lng: loc.longitude });

            return (
              <li key={loc.id} className="bg-paper border border-line rounded-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-semibold">{loc.name}</h3>
                      <Badge className="bg-grey-tint text-[#3f434b]">
                        {locationTypeLabel(loc.locationType)}
                      </Badge>
                      {loc.status === "needs_information" && (
                        <Badge className="bg-quad-tint text-[#8a6a00]">Needs info</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted mt-1">{loc.address}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                      {mapsUrl && (
                        <>
                          {" · "}
                          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                            map preview ↗
                          </a>
                        </>
                      )}
                    </p>
                    <p className="text-xs text-muted mt-1">
                      Submitted by <b>{submitter}</b> · {formatDate(loc.createdAt)} · source{" "}
                      {loc.sourceType}
                    </p>
                    {loc.description && (
                      <p className="text-sm text-ink-soft mt-2">{loc.description}</p>
                    )}
                    {loc.reviewNotes && (
                      <p className="text-sm text-muted mt-2 italic">Note: {loc.reviewNotes}</p>
                    )}
                    {(loc.websiteUrl || loc.instagramUrl) && (
                      <p className="text-xs mt-2 flex gap-3">
                        {loc.websiteUrl && (
                          <a href={loc.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                            website ↗
                          </a>
                        )}
                        {loc.instagramUrl && (
                          <a href={loc.instagramUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                            instagram ↗
                          </a>
                        )}
                      </p>
                    )}
                  </div>
                </div>

                {dupes.length > 0 && (
                  <div className="mt-4 bg-quad-tint/40 border border-quad/30 rounded-xl p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#8a6a00]">
                      Possible duplicates — review before approving
                    </p>
                    <ul className="mt-2 space-y-2">
                      {dupes.map((d) => (
                        <li key={d.id} className="text-sm flex flex-wrap items-center gap-2">
                          <span className="font-medium">{d.name}</span>
                          <span className="text-xs text-muted">
                            {Math.round(d.score * 100)}% · {d.reasons.join(", ")} · {d.status}
                          </span>
                          <form action={rejectLocationAction} className="inline">
                            <input type="hidden" name="id" value={loc.id} />
                            <input type="hidden" name="status" value="duplicate" />
                            <input type="hidden" name="duplicateOfId" value={d.id} />
                            <input type="hidden" name="reason" value={`Duplicate of ${d.name}`} />
                            <button className="text-xs font-semibold text-brand hover:underline">
                              Mark as duplicate of this
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-4">
                  <form action={approveLocationAction}>
                    <input type="hidden" name="id" value={loc.id} />
                    <button className="inline-flex items-center min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold">
                      Approve
                    </button>
                  </form>
                  <Link
                    href={`/admin/dropmeet/locations/${loc.id}`}
                    className="inline-flex items-center min-h-[44px] px-5 rounded-pill border border-line-strong text-sm font-semibold hover:border-ink/30 transition"
                  >
                    Edit before approving
                  </Link>
                  <form action={rejectLocationAction}>
                    <input type="hidden" name="id" value={loc.id} />
                    <input type="hidden" name="reason" value="Rejected in review" />
                    <button className="inline-flex items-center min-h-[44px] px-5 rounded-pill border border-line-strong text-sm font-semibold text-brand-dark hover:bg-brand-tint transition">
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Pending markets ──────────────────────────────────────────────── */}
      <h2 className="font-display text-lg font-semibold mb-3">Pending markets</h2>
      {pendingMarkets.length === 0 ? (
        <Empty>No markets waiting.</Empty>
      ) : (
        <ul className="space-y-4 mb-10">
          {pendingMarkets.map((m) => (
            <li key={m.id} className="bg-paper border border-line rounded-card p-5">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-semibold">{m.name}</h3>
                <Badge className="bg-grey-tint text-[#3f434b]">{marketTypeLabel(m.marketType)}</Badge>
                {m.location.status !== "approved" && (
                  <Badge className="bg-quad-tint text-[#8a6a00]">Location also pending</Badge>
                )}
              </div>
              <p className="text-sm text-muted mt-1">
                {m.location.name} · {m.location.address ?? "no address"}
              </p>
              {m.schedules.map((s) => (
                <p key={s.id} className="text-sm text-ink-soft mt-1">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.dayOfWeek ?? 0]} ·{" "}
                  {s.startTime}–{s.endTime} · {s.recurrence}
                </p>
              ))}
              {m.description && <p className="text-sm text-ink-soft mt-2">{m.description}</p>}
              <p className="text-xs text-muted mt-2">
                Submitted by{" "}
                <b>{m.submittedBySeller?.storeName ?? m.submittedByCustomer?.name ?? "Unknown"}</b> ·{" "}
                {formatDate(m.createdAt)}
              </p>

              <div className="flex flex-wrap gap-2 mt-4">
                <form action={approveMarketAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="inline-flex items-center min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold">
                    Approve market {m.location.status !== "approved" && "+ location"}
                  </button>
                </form>
                <form action={rejectMarketAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="reason" value="Rejected in review" />
                  <button className="inline-flex items-center min-h-[44px] px-5 rounded-pill border border-line-strong text-sm font-semibold text-brand-dark hover:bg-brand-tint transition">
                    Reject
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Claims ───────────────────────────────────────────────────────── */}
      <h2 className="font-display text-lg font-semibold mb-3">Organizer claims</h2>
      {claims.length === 0 ? (
        <Empty>No claims pending.</Empty>
      ) : (
        <ul className="space-y-3 mb-10">
          {claims.map((c) => (
            <li key={c.id} className="bg-paper border border-line rounded-card p-5">
              <p className="font-display font-semibold">
                {c.market?.name ?? c.location?.name ?? "Unknown"}
              </p>
              <p className="text-sm text-muted mt-1">
                {c.name} · {c.email}
                {c.role ? ` · ${c.role}` : ""}
                {c.organization ? ` · ${c.organization}` : ""}
              </p>
              {c.message && <p className="text-sm text-ink-soft mt-2 italic">“{c.message}”</p>}
              <p className="text-xs text-muted mt-2">
                Approving marks the market “organizer managed”. It does not grant edit access —
                there&apos;s no organizer portal yet.
              </p>
              <div className="flex gap-2 mt-3">
                <form action={reviewClaimAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="inline-flex items-center min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold">
                    Approve claim
                  </button>
                </form>
                <form action={reviewClaimAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <button className="inline-flex items-center min-h-[44px] px-5 rounded-pill border border-line-strong text-sm font-semibold">
                    Reject
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-line pt-6">
        <Link
          href="/admin/dropmeet/new"
          className="inline-flex items-center min-h-[48px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold"
        >
          + Add a place directly
        </Link>
        <p className="text-xs text-muted mt-2">
          Admin-created places publish immediately — use this for markets you&apos;ve verified
          yourself.
        </p>
      </div>
    </Section>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-paper border border-line rounded-card p-4">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="font-display text-2xl font-semibold mt-1">{value}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-paper border border-dashed border-line-strong rounded-card p-6 text-center text-muted text-sm mb-10">
      {children}
    </div>
  );
}
