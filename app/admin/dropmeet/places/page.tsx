import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { Badge } from "@/components/ui";

export const metadata = { title: "All places — DropMeet admin" };
export const dynamic = "force-dynamic";

/**
 * Every DropMeet place, in one browsable list.
 *
 * ── WHY THIS PAGE EXISTS ──────────────────────────────────────────────────
 *
 * The review panel at /admin/dropmeet shows the PENDING queues and a count of
 * what is approved. That is everything an admin needs on the day a place is
 * submitted, and nothing they need afterwards: once a place was approved it
 * left the panel and could not be found again. A place that closed down, was
 * approved by mistake, or turned out to be a duplicate had no route to being
 * edited, taken down, or removed.
 *
 * So: all statuses, searchable, with what is attached to each place visible
 * before you act on it.
 */

const STATUSES = ["all", "approved", "pending", "needs_information", "rejected", "duplicate"] as const;

function statusStyle(status: string) {
  if (status === "approved") return "bg-sage-tint text-sage";
  if (status === "pending") return "bg-quad-tint text-ink";
  if (status === "needs_information") return "bg-brand-tint text-brand-dark";
  return "bg-secondary-tint text-muted";
}

export default async function AdminPlacesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; deleted?: string; delete?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
    ? (sp.status as string)
    : "all";
  const q = (sp.q ?? "").trim();

  const locations = await prisma.location.findMany({
    where: {
      ...(status === "all" ? {} : { status }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { city: { contains: q, mode: "insensitive" as const } },
              { address: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true, name: true, city: true, state: true, status: true,
      locationType: true, createdAt: true,
      // Shown in the row so an admin knows what is attached before opening it.
      _count: { select: { markets: true, events: true, appearances: true, follows: true } },
      // Appearances also hang off a place's MARKETS, and a market cascades
      // when the place is deleted. Counting only `_count.appearances` would
      // print "0 appearances" for a place whose market has ten vendors on it.
      markets: { select: { _count: { select: { appearances: true } } } },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: 300,
  });

  const counts = await prisma.location.groupBy({ by: ["status"], _count: true });
  const countFor = (s: string) =>
    s === "all"
      ? counts.reduce((n, c) => n + c._count, 0)
      : counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <div className="max-w-6xl mx-auto px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight">All places</h1>
          <p className="text-muted mt-1">
            Every DropMeet place, whatever its status. Review queues live on the{" "}
            <Link href="/admin/dropmeet" className="text-brand hover:underline">
              DropMeet panel
            </Link>
            .
          </p>
        </div>
        <Link
          href="/admin/dropmeet/new"
          className="inline-flex items-center min-h-11 px-4 rounded-pill bg-ink text-cream text-sm font-semibold shrink-0"
        >
          + Add a place
        </Link>
      </div>

      {sp.deleted === "1" && (
        <p className="mb-4 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">
          ✓ Place deleted.
        </p>
      )}
      {sp.deleted === "missing" && (
        <p className="mb-4 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
          That place no longer exists — someone may have deleted it already.
        </p>
      )}
      {sp.delete === "blocked_appearances" && (
        <p className="mb-4 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
          Nothing was deleted — vendors have published appearances there.
          Unpublish it instead, which hides it and keeps their plans.
        </p>
      )}
      {sp.delete === "name_mismatch" && (
        <p className="mb-4 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
          The name didn&apos;t match, so nothing was deleted.
        </p>
      )}

      {/* Filters. A GET form so a filtered view is a shareable URL. */}
      <form method="get" className="flex flex-wrap items-end gap-2 mb-5">
        <label className="min-w-0 flex-1 sm:flex-none">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted mb-1">
            Search
          </span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, city or address"
            className="w-full sm:w-64 min-w-0 bg-paper border border-line-strong rounded-xl px-3 py-2.5 text-sm"
          />
        </label>
        <input type="hidden" name="status" value={status} />
        <button
          type="submit"
          className="inline-flex items-center min-h-11 px-4 rounded-xl bg-ink text-cream text-sm font-semibold"
        >
          Search
        </button>
        {(q || status !== "all") && (
          <Link
            href="/admin/dropmeet/places"
            className="inline-flex items-center min-h-11 px-4 rounded-xl border border-line-strong text-sm font-medium"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="flex flex-wrap gap-2 mb-5">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/dropmeet/places?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`inline-flex items-center min-h-11 px-3.5 rounded-pill text-sm font-medium border transition ${
              status === s
                ? "bg-ink text-cream border-ink"
                : "bg-paper border-line text-ink-soft hover:border-ink/30"
            }`}
          >
            {s.replace("_", " ")}{" "}
            <span className="ml-1.5 tabular-nums opacity-70">{countFor(s)}</span>
          </Link>
        ))}
      </div>

      {locations.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong p-10 text-center text-muted">
          No places match.
        </div>
      ) : (
        <ul className="space-y-2">
          {locations.map((l) => {
            const appearances =
              l._count.appearances +
              l.markets.reduce((n, m) => n + m._count.appearances, 0);
            const attached =
              l._count.markets + l._count.events + appearances + l._count.follows;
            return (
              <li key={l.id}>
                <Link
                  href={`/admin/dropmeet/locations/${l.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-paper border border-line rounded-card px-4 py-3 hover:border-ink/25 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{l.name}</span>
                      <Badge className={statusStyle(l.status)}>{l.status.replace("_", " ")}</Badge>
                    </div>
                    <p className="text-xs text-muted truncate mt-0.5">
                      {[l.city, l.state].filter(Boolean).join(", ") || "—"} · {l.locationType}
                    </p>
                  </div>
                  <span className="text-xs text-muted shrink-0 whitespace-nowrap">
                    {attached === 0
                      ? "nothing attached"
                      : `${appearances} appearance${appearances === 1 ? "" : "s"} · ${l._count.markets} market${l._count.markets === 1 ? "" : "s"}`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {locations.length === 300 && (
        <p className="text-xs text-muted mt-4">
          Showing the first 300. Narrow it with search or a status filter.
        </p>
      )}
    </div>
  );
}
