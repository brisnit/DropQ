"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { updateStoreAction, type StoreSaveState } from "@/lib/actions/dashboard";

const ACCENTS = ["#6D28D9", "#3a8895", "#3F7D5B", "#8A2D52", "#2B6CB0", "#1C1916"];

export type StoreFormData = {
  storeName: string;
  slug: string;
  tagline: string | null;
  bio: string | null;
  location: string | null;
  accent: string;
  feeMode: string;
  geofenceEnabled: boolean;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number;
};

function SaveButton({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : dirty ? "Save changes" : "Saved"}
    </Button>
  );
}

export function StoreSettingsForm({
  seller,
  feePercent,
}: {
  seller: StoreFormData;
  feePercent: number;
}) {
  const [state, formAction] = useActionState<StoreSaveState, FormData>(updateStoreAction, {});
  const [dirty, setDirty] = useState(false);
  const [geo, setGeo] = useState(seller.geofenceEnabled);

  return (
    <form
      action={formAction}
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="space-y-6 max-w-2xl"
    >
      {/* Profile */}
      <div className="bg-paper border border-line rounded-card p-6 sm:p-8 space-y-5">
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
                <input type="radio" name="accent" value={c} defaultChecked={seller.accent.toUpperCase() === c.toUpperCase()} className="peer sr-only" />
                <span className="block w-9 h-9 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-paper peer-checked:ring-ink transition" style={{ backgroundColor: c }} />
              </label>
            ))}
          </div>
        </Field>
      </div>

      {/* Fee handling */}
      <div className="bg-paper border border-line rounded-card p-6 sm:p-8">
        <h2 className="font-semibold text-lg">DropQ fee ({feePercent}%)</h2>
        <p className="text-muted text-sm mt-1">
          Choose who covers DropQ&apos;s {feePercent}% per-order fee. (Card-processing fees are separate and always paid from your Stripe payout.)
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <label className="block cursor-pointer">
            <input type="radio" name="feeMode" value="absorb" defaultChecked={seller.feeMode !== "pass"} className="peer sr-only" />
            <div className="rounded-xl border border-line-strong p-4 peer-checked:border-brand peer-checked:bg-brand-tint/40 transition">
              <p className="font-medium">I cover the fee</p>
              <p className="text-sm text-muted mt-1">Customer pays the menu price. The {feePercent}% comes out of your payout.</p>
            </div>
          </label>
          <label className="block cursor-pointer">
            <input type="radio" name="feeMode" value="pass" defaultChecked={seller.feeMode === "pass"} className="peer sr-only" />
            <div className="rounded-xl border border-line-strong p-4 peer-checked:border-brand peer-checked:bg-brand-tint/40 transition">
              <p className="font-medium">Customer pays the fee</p>
              <p className="text-sm text-muted mt-1">A small {feePercent}% service fee is added at checkout. You keep the full menu price.</p>
            </div>
          </label>
        </div>
      </div>

      {/* Geofencing */}
      <div className="bg-paper border border-line rounded-card p-6 sm:p-8">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="geofenceEnabled"
            defaultChecked={seller.geofenceEnabled}
            onChange={(e) => setGeo(e.target.checked)}
            className="mt-1 w-4 h-4 accent-[#6d28d9]"
          />
          <div>
            <p className="font-semibold">Geofencing notifications <span className="text-xs font-normal text-muted">(beta)</span></p>
            <p className="text-sm text-muted mt-0.5">
              Notify opted-in repeat customers when they&apos;re near your location during a live drop. Sending integrations are coming soon — this saves your settings now.
            </p>
          </div>
        </label>
        {geo && (
          <div className="mt-4 grid sm:grid-cols-3 gap-4">
            <Field label="Radius (meters)">
              <Input name="geofenceRadiusM" type="number" min={100} step={100} defaultValue={seller.geofenceRadiusM} />
            </Field>
            <Field label="Latitude" hint="Optional">
              <Input name="latitude" defaultValue={seller.latitude ?? ""} placeholder="30.2672" />
            </Field>
            <Field label="Longitude" hint="Optional">
              <Input name="longitude" defaultValue={seller.longitude ?? ""} placeholder="-97.7431" />
            </Field>
          </div>
        )}
        {!geo && <input type="hidden" name="geofenceRadiusM" value={seller.geofenceRadiusM} />}
      </div>

      <div className="flex items-center gap-3">
        <SaveButton dirty={dirty} />
        {state.saved && !dirty && (
          <span className="text-sm text-sage font-medium">✓ Saved</span>
        )}
        {state.error && <span className="text-sm text-brand-dark">{state.error}</span>}
      </div>
    </form>
  );
}
