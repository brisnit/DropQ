"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { updateStoreAction, type StoreSaveState } from "@/lib/actions/dashboard";

const ACCENTS = ["#cd1718", "#3a8895", "#3F7D5B", "#8A2D52", "#2B6CB0", "#1C1916"];
const isHex = (v: string) => /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(v);

export type StoreFormData = {
  storeName: string;
  slug: string;
  tagline: string | null;
  bio: string | null;
  location: string | null;
  logoUrl: string | null;
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
  const [accent, setAccent] = useState(seller.accent);
  const pickAccent = (v: string) => {
    setAccent(v);
    setDirty(true);
  };

  const logoRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const shownLogo = logoPreview || (logoRemoved ? null : seller.logoUrl);

  const onLogoFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview(URL.createObjectURL(file));
    setLogoRemoved(false);
    setDirty(true);
  };
  const removeLogo = () => {
    if (logoRef.current) logoRef.current.value = "";
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview(null);
    setLogoRemoved(true);
    setDirty(true);
  };

  return (
    <form
      action={formAction}
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="space-y-6 max-w-2xl"
    >
      {/* Profile */}
      <div className="bg-paper border border-line rounded-card p-6 sm:p-8 space-y-5">
        <input type="hidden" name="removeLogo" value={logoRemoved ? "1" : "0"} />
        <Field label="Store logo" hint="Square works best. Shown on your storefront.">
          <div className="flex items-center gap-4">
            <label className="relative w-20 h-20 rounded-2xl overflow-hidden border border-line-strong bg-cream grid place-items-center cursor-pointer group shrink-0">
              {shownLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shownLogo} alt="Store logo" className="w-full h-full object-cover" />
              ) : (
                <span className="font-display text-3xl font-semibold" style={{ color: accent }}>
                  {seller.storeName.charAt(0)}
                </span>
              )}
              <span className="absolute inset-0 bg-ink/45 text-white text-[11px] font-medium grid place-items-center opacity-0 group-hover:opacity-100 transition">
                {shownLogo ? "Change" : "📷 Upload"}
              </span>
              <input
                ref={logoRef}
                type="file"
                name="logo"
                accept="image/*"
                className="sr-only"
                onChange={(e) => onLogoFile(e.target.files?.[0])}
              />
            </label>
            <div className="text-sm">
              <p className="text-muted">PNG or JPG, up to 8MB.</p>
              {shownLogo && (
                <button type="button" onClick={removeLogo} className="mt-1 text-muted hover:text-brand">
                  Remove logo
                </button>
              )}
            </div>
          </div>
        </Field>
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
        <Field label="Brand accent" hint="Pick a preset or set any custom color.">
          <input type="hidden" name="accent" value={accent} />
          <div className="flex gap-3 flex-wrap items-center">
            {ACCENTS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => pickAccent(c)}
                aria-label={`Use ${c}`}
                className={`w-9 h-9 rounded-full ring-2 ring-offset-2 ring-offset-paper transition ${
                  accent.toUpperCase() === c.toUpperCase() ? "ring-ink" : "ring-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            {/* Custom color picker */}
            <label
              title="Custom color"
              className="relative w-9 h-9 rounded-full grid place-items-center border border-dashed border-line-strong cursor-pointer overflow-hidden hover:border-ink/40"
            >
              <input
                type="color"
                value={isHex(accent) ? accent : "#cd1718"}
                onChange={(e) => pickAccent(e.target.value)}
                className="absolute -inset-2 opacity-0 cursor-pointer"
              />
              <span className="text-sm">🎨</span>
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span
              className="w-7 h-7 rounded-md border border-line shrink-0"
              style={{ backgroundColor: isHex(accent) ? accent : "transparent" }}
            />
            <input
              value={accent}
              onChange={(e) => pickAccent(e.target.value)}
              placeholder="#cd1718"
              aria-label="Custom hex color"
              className="w-32 bg-paper border border-line-strong rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            {!isHex(accent) && <span className="text-xs text-brand-dark">Enter a hex like #cd1718</span>}
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
            className="mt-1 w-4 h-4 accent-[#cd1718]"
          />
          <div>
            <p className="font-semibold">Geofencing notifications <span className="text-xs font-normal text-muted">(beta)</span></p>
            <p className="text-sm text-muted mt-0.5">
              Notify opted-in repeat customers when they&apos;re near you during a live
              drop. We&apos;ll find your coordinates from your <b>Location</b> above
              automatically. (Push delivery arrives with the mobile app — this saves your settings now.)
            </p>
          </div>
        </label>
        {geo && (
          <div className="mt-4 grid sm:grid-cols-3 gap-4">
            <Field label="Radius (meters)">
              <Input name="geofenceRadiusM" type="number" min={100} step={100} defaultValue={seller.geofenceRadiusM} />
            </Field>
            <Field label="Latitude" hint="Auto-filled — override if needed">
              <Input name="latitude" defaultValue={seller.latitude ?? ""} placeholder="from Location" />
            </Field>
            <Field label="Longitude" hint="Auto-filled — override if needed">
              <Input name="longitude" defaultValue={seller.longitude ?? ""} placeholder="from Location" />
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
