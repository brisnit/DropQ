"use client";

import { useState } from "react";
import { useActionState } from "react";
import { createMapsUrl } from "@/lib/maps";
import { track } from "@/lib/analytics";
import {
  submitClaimAction,
  submitVendorLeadAction,
  toggleLocationFollowAction,
  toggleMarketFollowAction,
} from "@/lib/actions/dropmeet";
import type { SimpleState } from "@/lib/actions/dropmeet";

/** Directions button — reuses the app's existing maps deep-link helper. */
export function DirectionsButton({
  address,
  lat,
  lng,
  label = "Directions",
}: {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  label?: string;
}) {
  const href = createMapsUrl({ address, lat, lng });
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track("directions_clicked", {})}
      className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold text-ink hover:border-ink/30 transition"
    >
      🧭 {label}
    </a>
  );
}

/**
 * Follow toggle. Signed-out customers are sent to the magic-link sign-in with a
 * return path, so following never dead-ends.
 */
export function FollowButton({
  kind,
  id,
  slug,
  following,
  signedIn,
}: {
  kind: "location" | "market";
  id: string;
  slug: string;
  following: boolean;
  signedIn: boolean;
}) {
  const action = kind === "location" ? toggleLocationFollowAction : toggleMarketFollowAction;
  const returnTo = `/dropmeet/${kind === "location" ? "locations" : "markets"}/${slug}`;

  if (!signedIn) {
    return (
      <a
        href={`/messages/login?next=${encodeURIComponent(returnTo)}`}
        className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold text-ink hover:border-ink/30 transition"
      >
        ☆ Follow
      </a>
    );
  }

  return (
    <form
      action={async (fd) => {
        track(
          following
            ? kind === "market"
              ? "market_unfollowed"
              : "location_unfollowed"
            : kind === "market"
              ? "market_followed"
              : "location_followed",
          { id }
        );
        await action(fd);
      }}
    >
      <input type="hidden" name={kind === "location" ? "locationId" : "marketId"} value={id} />
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        className={`inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-pill text-sm font-semibold transition active:scale-[0.98] ${
          following
            ? "bg-ink text-cream"
            : "border border-line-strong bg-paper text-ink hover:border-ink/30"
        }`}
      >
        {following ? "★ Following" : "☆ Follow"}
      </button>
    </form>
  );
}

/** "Are you the organizer? Claim this DropMeet." A request, never a grant. */
export function ClaimPanel({
  entityType,
  entityId,
  name,
}: {
  entityType: "location" | "market";
  entityId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(submitClaimAction, {});

  if (state.ok) {
    return (
      <div className="bg-paper border border-line rounded-card p-5 text-sm">
        <p className="font-display font-semibold">Claim received</p>
        <p className="text-muted mt-1">
          The DropQ team will review it and get in touch. Claiming doesn&apos;t change anything on
          the page until it&apos;s approved.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          track("claim_requested", { entityType, entityId });
        }}
        className="text-sm text-muted hover:text-ink underline underline-offset-2"
      >
        Are you the organizer? Claim this DropMeet.
      </button>
    );
  }

  const input =
    "w-full min-h-[48px] bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition";

  return (
    <form action={formAction} className="bg-paper border border-line rounded-card p-5 space-y-3">
      <input type="hidden" name="entityType" value={entityType} />
      <input
        type="hidden"
        name={entityType === "location" ? "locationId" : "marketId"}
        value={entityId}
      />
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display font-semibold">Claim {name}</h3>
          <p className="text-xs text-muted mt-0.5">
            We&apos;ll verify before giving anyone control of this page.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted">
          Cancel
        </button>
      </div>
      <input name="name" required placeholder="Your name" className={input} />
      <input name="email" type="email" required placeholder="Email" className={input} />
      <input name="role" placeholder="Your role (e.g. Market Manager)" className={input} />
      <input name="organization" placeholder="Organization (optional)" className={input} />
      <textarea name="message" placeholder="Anything we should know?" className={`${input} min-h-[80px] resize-y`} />
      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full min-h-[48px] rounded-xl bg-ink text-cream font-semibold text-sm disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send claim request"}
      </button>
    </form>
  );
}

/** "Know a vendor who sells here?" — a growth lead form. */
export function InviteVendorPanel({
  locationId,
  marketId,
}: {
  locationId?: string;
  marketId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(
    submitVendorLeadAction,
    {}
  );

  if (state.ok) {
    return (
      <p className="text-sm text-ink-soft bg-sage-tint rounded-xl px-4 py-3">
        Thanks — we&apos;ll reach out to them about DropQ.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          track("vendor_invited", { locationId, marketId });
        }}
        className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold hover:border-ink/30 transition"
      >
        Invite a vendor
      </button>
    );
  }

  const input =
    "w-full min-h-[48px] bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition";

  return (
    <form action={formAction} className="bg-paper border border-line rounded-card p-5 space-y-3">
      {locationId && <input type="hidden" name="locationId" value={locationId} />}
      {marketId && <input type="hidden" name="marketId" value={marketId} />}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display font-semibold">Know a vendor who sells here?</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted">
          Cancel
        </button>
      </div>
      <input name="businessName" required placeholder="Vendor or business name" className={input} />
      <input name="website" placeholder="Website or Instagram (optional)" className={input} />
      <input name="email" type="email" placeholder="Their email (optional)" className={input} />
      <input name="submitterEmail" type="email" placeholder="Your email (optional)" className={input} />
      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full min-h-[48px] rounded-xl bg-ink text-cream font-semibold text-sm disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
