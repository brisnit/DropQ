import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { PageHeader, Section } from "@/components/dashboard-ui";
import { AddPlaceForm } from "@/components/dropmeet/add-place-form";

export const metadata = { title: "DropMeet — DropQ" };

/**
 * DropMeet inside the dashboard.
 *
 * A signed-in vendor who wanted to add a market had nowhere to do it. The
 * public /dropmeet/add page exists, but arriving there from a logged-in
 * session dropped them back on the dashboard with no route onward — so the
 * one group of people most likely to know which markets are missing were the
 * ones who could not tell us.
 *
 * The form is the same component the public page uses. A vendor is already
 * signed in, so it skips the sign-in step and opens straight on the fields.
 */
export default async function DashboardDropMeetPage() {
  await requireSeller();

  return (
    <Section>
      <PageHeader
        title="DropMeet"
        subtitle="Markets, breweries, parks and pop-up venues where local vendors sell. Add a place you know and we'll review it."
        action={
          <Link
            href="/dropmeet"
            target="_blank"
            className="text-sm font-medium text-brand hover:underline"
          >
            Browse DropMeet ↗
          </Link>
        }
      />

      {/* Where I'll Be is the other half of this: once a place exists, that is
          where a vendor says they will be at it. Linked so the two are not
          two unrelated pages that happen to be about the same thing. */}
      <p className="text-sm text-muted mb-5">
        Already know where you&apos;ll be selling?{" "}
        <Link href="/dashboard/where-ill-be" className="text-ink font-medium underline underline-offset-4">
          Add it to your schedule
        </Link>
        .
      </p>

      <div className="max-w-xl">
        <AddPlaceForm signedIn />
      </div>
    </Section>
  );
}
