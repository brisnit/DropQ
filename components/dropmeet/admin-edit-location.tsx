"use client";

import { useState } from "react";
import { useActionState } from "react";
import { editLocationAction, type SimpleState } from "@/lib/actions/dropmeet";
import { LOCATION_TYPES, VERIFICATION_STATUSES } from "@/lib/dropmeet/types";

type Loc = {
  id: string;
  name: string;
  locationType: string;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  latitude: number;
  longitude: number;
  websiteUrl: string | null;
  instagramUrl: string | null;
  phone: string | null;
  verificationStatus: string;
};

const input =
  "w-full min-h-[48px] bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition";

/**
 * Admin correction form. Coordinates are editable but always re-validated
 * against the region polygon server-side — an admin can fix a bad geocode, but
 * cannot drag a place outside San Diego County.
 */
export function AdminEditLocationForm({ location }: { location: Loc }) {
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(editLocationAction, {});
  const [lat, setLat] = useState(String(location.latitude));
  const [lng, setLng] = useState(String(location.longitude));

  return (
    <form action={formAction} className="bg-paper border border-line rounded-card p-5 space-y-4 max-w-2xl">
      <input type="hidden" name="id" value={location.id} />

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">Name</span>
        <input name="name" defaultValue={location.name} required className={input} />
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-ink-soft mb-1.5">Category</span>
          <select name="locationType" defaultValue={location.locationType} className={input}>
            {Object.entries(LOCATION_TYPES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-ink-soft mb-1.5">Verification</span>
          <select name="verificationStatus" defaultValue={location.verificationStatus} className={input}>
            {Object.entries(VERIFICATION_STATUSES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">Address</span>
        <input name="address" defaultValue={location.address ?? ""} className={input} />
      </label>

      <div className="grid grid-cols-3 gap-3">
        <input name="city" defaultValue={location.city ?? ""} placeholder="City" className={input} />
        <input name="state" defaultValue={location.state ?? ""} placeholder="State" className={input} />
        <input
          name="postalCode"
          defaultValue={location.postalCode ?? ""}
          placeholder="ZIP"
          className={input}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-ink-soft mb-1.5">Latitude</span>
          <input name="latitude" value={lat} onChange={(e) => setLat(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-ink-soft mb-1.5">Longitude</span>
          <input name="longitude" value={lng} onChange={(e) => setLng(e.target.value)} className={input} />
        </label>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">Description</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={location.description ?? ""}
          className={`${input} resize-y`}
        />
      </label>

      <div className="grid sm:grid-cols-3 gap-3">
        <input name="websiteUrl" defaultValue={location.websiteUrl ?? ""} placeholder="Website" className={input} />
        <input
          name="instagramUrl"
          defaultValue={location.instagramUrl ?? ""}
          placeholder="Instagram"
          className={input}
        />
        <input name="phone" defaultValue={location.phone ?? ""} placeholder="Phone" className={input} />
      </div>

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-sm text-ink-soft bg-sage-tint rounded-lg px-3 py-2">Changes saved.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-[48px] px-6 rounded-pill border border-line-strong text-sm font-semibold hover:border-ink/30 transition disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
