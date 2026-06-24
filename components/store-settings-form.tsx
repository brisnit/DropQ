"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { updateStoreAction, type StoreSaveState } from "@/lib/actions/dashboard";
import { SOCIALS } from "@/lib/social";
import { uploadImage, ImageTooLargeError } from "@/lib/upload-client";

const ACCENTS = ["#ff6268", "#3a8895", "#3F7D5B", "#8A2D52", "#2B6CB0", "#1C1916"];
const isHex = (v: string) => /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(v);

export type StoreFormData = {
  storeName: string;
  slug: string;
  tagline: string | null;
  bio: string | null;
  location: string | null;
  logoUrl: string | null;
  headerImageUrl: string | null;
  accent: string;
  instagram: string | null;
  tiktok: string | null;
  twitter: string | null;
  facebook: string | null;
  youtube: string | null;
  website: string | null;
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

  // Logo / header are uploaded to the server upload route on selection (one
  // small request each), then submitted as URLs — never as file bytes through
  // the save action, which would 413 on large/undecodable photos.
  const [imgError, setImgError] = useState<string | null>(null);

  const [logoUrl, setLogoUrl] = useState<string | null>(seller.logoUrl);
  const [logoBusy, setLogoBusy] = useState(false);
  const shownLogo = logoUrl;

  const uploadFor = async (
    input: HTMLInputElement,
    setUrl: (u: string) => void,
    setBusy: (b: boolean) => void
  ) => {
    const file = input.files?.[0];
    input.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setImgError(null);
    setBusy(true);
    try {
      const url = await uploadImage(file);
      setUrl(url);
      setDirty(true);
    } catch (e) {
      setImgError(
        e instanceof ImageTooLargeError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Couldn't upload that image."
      );
    } finally {
      setBusy(false);
    }
  };

  const onLogoFile = (input: HTMLInputElement) => uploadFor(input, setLogoUrl, setLogoBusy);
  const removeLogo = () => {
    setLogoUrl(null);
    setDirty(true);
  };

  const [headerUrl, setHeaderUrl] = useState<string | null>(seller.headerImageUrl);
  const [headerBusy, setHeaderBusy] = useState(false);
  const shownHeader = headerUrl;

  const onHeaderFile = (input: HTMLInputElement) => uploadFor(input, setHeaderUrl, setHeaderBusy);
  const removeHeader = () => {
    setHeaderUrl(null);
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
        <input type="hidden" name="logoUrl" value={logoUrl ?? ""} />
        <input type="hidden" name="headerImageUrl" value={headerUrl ?? ""} />
        {imgError && (
          <p className="text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">{imgError}</p>
        )}
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
              {logoBusy && (
                <span className="absolute inset-0 bg-paper/80 grid place-items-center text-xs text-muted animate-pulse">
                  Uploading…
                </span>
              )}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => onLogoFile(e.currentTarget)}
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

        <Field
          label="Header background"
          hint="Shown as the banner at the top of your storefront. Solid accent color is used if no image is set."
        >
          <label className="relative block w-full aspect-[4/1] rounded-2xl overflow-hidden border border-line-strong cursor-pointer group">
            {shownHeader ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shownHeader} alt="Store header" className="w-full h-full object-cover" />
            ) : (
              <span className="absolute inset-0" style={{ backgroundColor: accent }} />
            )}
            <span className="absolute inset-0 bg-ink/40 text-white text-sm font-medium grid place-items-center opacity-0 group-hover:opacity-100 transition">
              {shownHeader ? "Change header image" : "📷 Upload header image"}
            </span>
            {headerBusy && (
              <span className="absolute inset-0 bg-paper/80 grid place-items-center text-sm text-muted animate-pulse">
                Uploading…
              </span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              className="sr-only"
              onChange={(e) => onHeaderFile(e.currentTarget)}
            />
          </label>
          <div className="mt-2 flex items-center justify-between gap-3 text-sm">
            <p className="text-muted">
              Best size <b>1600×400px</b> (4:1, landscape). JPG, PNG, WebP or AVIF, up to 8MB.
            </p>
            {shownHeader && (
              <button type="button" onClick={removeHeader} className="text-muted hover:text-brand shrink-0">
                Remove
              </button>
            )}
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
        <Field
          label="Store location"
          hint="Your city/area — shown on your storefront with a 📍. Set the exact pickup or delivery address on each drop."
        >
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
                value={isHex(accent) ? accent : "#ff6268"}
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
              placeholder="#ff6268"
              aria-label="Custom hex color"
              className="w-32 bg-paper border border-line-strong rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            {!isHex(accent) && <span className="text-xs text-brand-dark">Enter a hex like #ff6268</span>}
          </div>
        </Field>
      </div>

      {/* Social media */}
      <div className="bg-paper border border-line rounded-card p-6 sm:p-8 space-y-4">
        <div>
          <h2 className="font-semibold text-lg">Social media</h2>
          <p className="text-muted text-sm mt-1">
            Add your handles or links — they appear as icons on your storefront so customers can follow you.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {SOCIALS.map((s) => (
            <Field key={s.key} label={s.label}>
              <Input
                name={`social_${s.key}`}
                defaultValue={seller[s.key] ?? ""}
                placeholder={s.placeholder}
                autoComplete="off"
              />
            </Field>
          ))}
        </div>
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
            className="mt-1 w-4 h-4 accent-[#ff6268]"
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
