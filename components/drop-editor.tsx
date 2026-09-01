"use client";

import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Textarea, Select } from "@/components/ui";
import { vocab, showItemMeta, isFood } from "@/lib/category";
import { uploadImage, ImageTooLargeError } from "@/lib/upload-client";
import { DateRangePicker } from "@/components/date-range-picker";
import { MIN_PRODUCT_PRICE_CENTS } from "@/lib/checkout-limits";

/**
 * A typed price that Stripe could not charge for.
 *
 * Empty and half-typed values are NOT flagged — nagging someone mid-keystroke
 * is worse than letting the server answer. Only a complete, parseable number
 * under the floor lights up.
 */
function belowMinimum(price: string): boolean {
  const trimmed = price.trim();
  if (!trimmed) return false;
  const n = Number(trimmed);
  if (!isFinite(n) || n <= 0) return false;
  return Math.round(n * 100) < MIN_PRODUCT_PRICE_CENTS;
}
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { firstScheduleError } from "@/lib/drop-schedule";
import { removalWarning } from "@/lib/drop-items";

const MAX_IMAGES_PER_PRODUCT = 6;

export type DropDefaults = {
  title?: string;
  description?: string;
  fulfillment?: string;
  location?: string;
  opensAt?: string; // ISO instant
  closesAt?: string;
  pickupStartAt?: string;
  pickupEndAt?: string;
  pickupLocationName?: string;
  pickupAddress?: string;
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickupNotes?: string;
  pickupFindMe?: string;
  pickupLine1?: string | null;
  pickupCity?: string | null;
  pickupState?: string | null;
  pickupPostal?: string | null;
  pickupCountry?: string | null;
  status?: string;
  products?: Array<{
    id?: string;
    vendorProductId?: string | null;
    emoji?: string;
    name?: string;
    desc?: string;
    price?: string;
    inventory?: string;
    imageUrl?: string | null;
    images?: string[];
    productType?: string;
    condition?: string;
    rarity?: string;
    /** Orders that reference this item. Drives the removal warning. */
    orderCount?: number;
  }>;
};

// A saved library item the vendor can add to this drop.
export type SavedProduct = {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  price: string;
  imageUrl: string | null;
  images: string[];
  category: string;
  productType: string;
  condition: string;
  rarity: string;
};

type Row = {
  key: number;
  id?: string;
  vendorProductId?: string | null; // set when the row came from the saved library
  emoji: string;
  name: string;
  desc: string;
  price: string;
  inventory: string;
  productType: string;
  condition: string;
  rarity: string;
  images: string[]; // uploaded photo URLs (first is the cover); persisted as-is
  uploading: number; // count of in-flight uploads for this row
  /** Orders referencing this item. 0 for anything added in this session. */
  orderCount: number;
};

const FOOD_EMOJI = ["🍪", "🥐", "🍞", "🧁", "🎂", "🥧", "🍩", "🟤", "🍌", "🥗", "🍜", "🌮", "🍱", "🫙", "❤️", "🔥"];
const OBJECT_EMOJI = ["🃏", "🎴", "🧸", "🎨", "🖼️", "🏆", "💎", "👕", "🧢", "👟", "⚾", "🏀", "📦", "✨", "❤️", "🔥"];

let counter = 0;
const blankRow = (emoji: string): Row => ({
  key: counter++,
  emoji,
  name: "",
  desc: "",
  price: "",
  inventory: "",
  productType: "",
  condition: "",
  rarity: "",
  images: [],
  uploading: 0,
  orderCount: 0,
});

const rowFromSaved = (sp: SavedProduct, fallbackEmoji: string): Row => ({
  key: counter++,
  vendorProductId: sp.id,
  emoji: sp.emoji || fallbackEmoji,
  name: sp.name,
  desc: sp.desc,
  price: sp.price,
  inventory: "", // vendor sets stock per drop
  productType: sp.productType,
  condition: sp.condition,
  rarity: sp.rarity,
  images: sp.images?.length ? sp.images : sp.imageUrl ? [sp.imageUrl] : [],
  uploading: 0,
  orderCount: 0,
});

function SaveBar({
  mode,
  status,
  live,
  publishGate,
}: {
  mode: "create" | "edit";
  status: string;
  live: boolean;
  /** Set when the vendor isn't Stripe charge-ready — see lib/activation.ts. */
  publishGate?: { reason: string; cta: string; href: string } | null;
}) {
  const { pending } = useFormStatus();

  // Not charge-ready: don't offer a Publish button the server will refuse.
  // "Save as draft" becomes the primary action so the obvious button is the one
  // that works, and nothing the vendor typed is lost. Edit mode is untouched —
  // it submits the drop's existing status and can never publish.
  if (mode === "create" && publishGate) {
    return (
      <div
        data-guidance-anchor="editor.saveBar"
        className="sticky bottom-0 -mx-5 sm:-mx-8 px-5 sm:px-8 py-4 bg-cream/90 backdrop-blur border-t border-line flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-sm text-ink-soft max-w-md">
          {publishGate.reason} Your work is saved as a draft in the meantime.
        </p>
        <div className="flex gap-2 ml-auto">
          <a
            href={publishGate.href}
            className="inline-flex items-center text-sm font-medium inline-flex items-center justify-center min-h-11 px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition whitespace-nowrap"
          >
            {publishGate.cta} →
          </a>
          <Button type="submit" name="status" value="draft" disabled={pending}>
            {pending ? "Saving…" : "Save as draft"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-guidance-anchor="editor.saveBar"
      className="sticky bottom-0 -mx-5 sm:-mx-8 px-5 sm:px-8 py-4 bg-cream/90 backdrop-blur border-t border-line flex items-center justify-between gap-3"
    >
      <p className="text-sm text-muted hidden sm:block">
        {mode === "create"
          ? live
            ? "Live selling opens immediately so customers can order on-site."
            : "You can edit everything after creating."
          : "Changes save to this drop — no duplicate is created."}
      </p>
      <div className="flex gap-2 ml-auto">
        {mode === "create" ? (
          live ? (
            <Button type="submit" name="status" value="live" disabled={pending}>
              {pending ? "Starting…" : "Start live selling"}
            </Button>
          ) : (
            <>
              <Button type="submit" name="status" value="draft" variant="secondary" disabled={pending}>
                Save as draft
              </Button>
              <Button type="submit" name="status" value="live" disabled={pending}>
                {pending ? "Publishing…" : "Publish drop"}
              </Button>
            </>
          )
        ) : (
          <Button type="submit" name="status" value={status} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function DropEditor({
  action,
  mode = "create",
  defaults = {},
  dropId,
  category = "food",
  dropMode = "preorder",
  publishGate = null,
  timeZone,
  savedProducts = [],
}: {
  action: (formData: FormData) => void | Promise<void>;
  mode?: "create" | "edit";
  defaults?: DropDefaults;
  dropId?: string;
  category?: string;
  dropMode?: "preorder" | "live";
  /** Non-null when the vendor is not Stripe charge-ready (create mode only). */
  publishGate?: { reason: string; cta: string; href: string } | null;
  timeZone?: string;
  savedProducts?: SavedProduct[];
}) {
  const v = vocab(category);
  const meta = showItemMeta(category);
  const live = dropMode === "live";
  const defaultEmoji = isFood(category) ? "🍪" : "📦";
  const emojiChoices = isFood(category) ? FOOD_EMOJI : OBJECT_EMOJI;

  const initialRows: Row[] =
    defaults.products && defaults.products.length
      ? defaults.products.map((p) => ({
          key: counter++,
          id: p.id,
          vendorProductId: p.vendorProductId ?? null,
          emoji: p.emoji || defaultEmoji,
          name: p.name ?? "",
          desc: p.desc ?? "",
          price: p.price ?? "",
          inventory: p.inventory ?? "",
          productType: p.productType ?? "",
          condition: p.condition ?? "",
          rarity: p.rarity ?? "",
          images: p.images?.length ? p.images : p.imageUrl ? [p.imageUrl] : [],
          uploading: 0,
          orderCount: p.orderCount ?? 0,
        }))
      : [blankRow(defaultEmoji), blankRow(defaultEmoji)];

  const [rows, setRows] = useState<Row[]>(initialRows);
  /**
   * Prefix for the per-item field ids that the price / quantity labels point
   * at. NOT `row.key`: that counter is module state, so it keeps climbing on
   * the server across requests while a fresh client starts at zero, and the
   * ids hydrate mismatched. `useId()` is generated to match on both sides.
   */
  const fieldId = useId();
  const [error, setError] = useState<string | null>(null);
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [libOpen, setLibOpen] = useState(false);
  const [libQuery, setLibQuery] = useState("");

  // Names already on the drop — so the library picker can mark/skip duplicates.
  const usedNames = new Set(rows.map((r) => r.name.trim().toLowerCase()).filter(Boolean));
  const libMatches = savedProducts.filter((sp) =>
    sp.name.toLowerCase().includes(libQuery.trim().toLowerCase())
  );

  const addFromLibrary = (sp: SavedProduct) => {
    setRows((rs) => {
      // Replace a leading empty row rather than stacking a blank one.
      const firstEmpty = rs.findIndex((r) => !r.name.trim() && !r.images.length);
      const next = rowFromSaved(sp, defaultEmoji);
      if (firstEmpty >= 0) {
        const copy = [...rs];
        copy[firstEmpty] = next;
        return copy;
      }
      return [...rs, next];
    });
  };

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // Removing an item customers have already bought is not the same action as
  // removing a typo, so it doesn't happen on one unconfirmed click. The item is
  // never destroyed — the server retires it (see lib/drop-items.ts) — but the
  // vendor still needs to know it will leave their storefront.
  const remove = (key: number) => {
    const row = rows.find((r) => r.key === key);
    if (row && row.orderCount > 0) {
      const name = row.name.trim() || `this ${v.itemNoun}`;
      if (!window.confirm(removalWarning(name, row.orderCount))) return;
    }
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.key !== key)));
  };

  // Compress + upload each chosen file straight to Blob, appending URLs to the
  // row. Capped per product; oversized files are rejected with a message.
  const handleFiles = async (key: number, fileList: FileList | null) => {
    if (!fileList?.length) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    const row = rows.find((r) => r.key === key);
    const room = MAX_IMAGES_PER_PRODUCT - (row ? row.images.length : 0);
    const toUpload = files.slice(0, Math.max(0, room));
    if (toUpload.length < files.length) {
      setError(`Up to ${MAX_IMAGES_PER_PRODUCT} photos per item.`);
    }
    if (!toUpload.length) return;

    update(key, { uploading: (row?.uploading ?? 0) + toUpload.length });
    await Promise.all(
      toUpload.map(async (file) => {
        try {
          const url = await uploadImage(file);
          setRows((rs) =>
            rs.map((r) =>
              r.key === key
                ? { ...r, images: [...r.images, url], uploading: Math.max(0, r.uploading - 1) }
                : r
            )
          );
        } catch (err) {
          console.error("Product image upload failed:", err);
          setRows((rs) =>
            rs.map((r) =>
              r.key === key ? { ...r, uploading: Math.max(0, r.uploading - 1) } : r
            )
          );
          setError(
            err instanceof ImageTooLargeError
              ? err.message
              : `Couldn't upload that image: ${
                  err instanceof Error ? err.message : "unknown error"
                }`
          );
        }
      })
    );
  };

  const removeImage = (key: number, idx: number) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === key ? { ...r, images: r.images.filter((_, i) => i !== idx) } : r
      )
    );

  // Client-side validation that runs before the server action.
  const validate = (e: React.FormEvent<HTMLFormElement>) => {
    if (!live) {
      const fd = new FormData(e.currentTarget);
      const at = (k: string) => {
        const v = String(fd.get(k) ?? "");
        return v ? new Date(v) : null;
      };
      const opens = at("opensAt");
      const closes = at("closesAt");

      // A new preorder drop needs an order window at all. This is stricter than
      // the shared relational rules, which permit a drop with neither date so
      // that historical drops saved that way stay editable.
      if (!opens || !closes) {
        e.preventDefault();
        setError("Please set both an open and a close date/time.");
        return;
      }

      // Same rules the server enforces, so the message a vendor sees here is
      // exactly what would otherwise be rejected on save. Editing a drop whose
      // stored dates are already invalid surfaces the error here too — the
      // picker re-emits what's stored, so nothing is silently corrected.
      const scheduleError = firstScheduleError({
        opensAt: opens,
        closesAt: closes,
        pickupStartAt: at("pickupStartAt"),
        pickupEndAt: at("pickupEndAt"),
      });
      if (scheduleError) {
        e.preventDefault();
        setError(scheduleError);
        return;
      }
    }
    const hasItem = rows.some((r) => r.name.trim().length > 0);
    if (!hasItem) {
      e.preventDefault();
      setError(`Add at least one ${v.itemNoun} with a name.`);
      return;
    }
    setError(null);
  };

  return (
    <form action={action} onSubmit={validate} className="space-y-8">
      {dropId && <input type="hidden" name="dropId" value={dropId} />}
      <input type="hidden" name="mode" value={dropMode} />
      {/* Drop details */}
      <div className="bg-paper border border-line rounded-card p-4 sm:p-6 space-y-5">
        <h2 className="font-semibold text-lg">{live ? "Live drop details" : "Drop details"}</h2>
        {live && (
          <p className="text-sm rounded-xl bg-ink text-white px-4 py-3">
            Live selling mode — customers scan your QR and order on the spot. Orders appear in your dashboard in real time.
          </p>
        )}
        <Field label="Title" hint={`What you'd call this ${live ? "live event" : "drop"}.`}>
          <Input
            name="title"
            defaultValue={defaults.title ?? ""}
            placeholder={isFood(category) ? "Friday Cookie Drop — Brown Butter Week" : "Saturday Card Show — Booth 14"}
            required
          />
        </Field>
        <Field label="Description">
          <Textarea
            name="description"
            defaultValue={defaults.description ?? ""}
            placeholder={
              isFood(category)
                ? "Tell customers what's special this week, and any details they should know."
                : "Tell customers what you've got, condition notes, and anything they should know."
            }
          />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Fulfillment">
            <Select name="fulfillment" defaultValue={defaults.fulfillment ?? (live ? "handoff" : "pickup")}>
              <option value="pickup">Pickup</option>
              <option value="delivery">Local delivery</option>
              <option value="handoff">On-site / local handoff</option>
            </Select>
          </Field>
          <Field
            label={live ? "Location / booth" : "Location"}
            hint={live ? "Where you're set up (table, booth, address)." : "Where customers pick up, or your delivery area."}
          >
            <Input
              name="pickupInfo"
              defaultValue={defaults.location ?? ""}
              placeholder={isFood(category) ? "2118 E Cesar Chavez, Austin" : "Booth 14, City Card Show"}
            />
          </Field>
        </div>
        {!live && (
          <div>
            {/* Framed as step 1 of 2. The two windows are a sequence, and a
                vendor who meets them as unrelated date fields learns the
                relationship from a validation error instead.

                The guidance anchor sits on this LABEL rather than the section:
                with its calendar open the section is ~719px tall, which leaves
                a coachmark nowhere to go but on top of the very control it is
                describing. A small target points, and rings, precisely. */}
            <p className="text-sm font-medium text-ink mb-1" data-guidance-anchor="editor.orderWindow">
              <span className="text-muted font-normal">Step 1 of 2 · </span>
              Customers can order
            </p>
            <p className="text-sm text-muted mb-3">
              From when, until when. Ordering locks itself at the close time — you don&apos;t
              have to be there.
            </p>
            <DateRangePicker
              defaultStart={defaults.opensAt}
              defaultEnd={defaults.closesAt}
              timeZone={timeZone}
              startName="opensAt"
              endName="closesAt"
              fromLabel="Opens"
              toLabel="Closes"
            />
          </div>
        )}
      </div>

      {/* Pickup window + location (preorder drops) */}
      {!live && (
        <div className="bg-paper border border-line rounded-card p-4 sm:p-6 space-y-5">
          <div>
            <h2 className="font-semibold text-lg">Pickup</h2>
            <p className="text-sm text-muted mt-0.5">
              Ordering closes, you make everything, then customers collect. This is that
              second window.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-ink mb-1" data-guidance-anchor="editor.pickupWindow">
              <span className="text-muted font-normal">Step 2 of 2 · </span>
              Customers pick up
            </p>
            <p className="text-sm text-muted mb-3">
              Starts on or after ordering closes, so you have time to make the orders.
            </p>
            <DateRangePicker
              defaultStart={defaults.pickupStartAt}
              defaultEnd={defaults.pickupEndAt}
              timeZone={timeZone}
              startName="pickupStartAt"
              endName="pickupEndAt"
              fromLabel="Pickup opens"
              toLabel="Pickup ends"
            />
          </div>

          <Field label="Pickup location name" hint="Optional label shown to customers (e.g. “The shop”, “Front porch”).">
            <Input
              name="pickupLocationName"
              defaultValue={defaults.pickupLocationName ?? ""}
              placeholder="The shop"
            />
          </Field>

          <Field label="Pickup address">
            <AddressAutocomplete
              defaultAddress={defaults.pickupAddress ?? ""}
              defaultLat={defaults.pickupLat ?? null}
              defaultLng={defaults.pickupLng ?? null}
              defaultStructured={{
                line1: defaults.pickupLine1 ?? undefined,
                city: defaults.pickupCity ?? undefined,
                state: defaults.pickupState ?? undefined,
                postalCode: defaults.pickupPostal ?? undefined,
                country: defaults.pickupCountry ?? undefined,
              }}
            />
          </Field>

          <Field
            label="How to find you"
            hint="What customers should look for when they arrive — helps them spot you fast."
          >
            <Input
              name="pickupFindMe"
              defaultValue={defaults.pickupFindMe ?? ""}
              placeholder="Blue canopy near the fountain · White Ford Transit with a folding table"
            />
          </Field>

          <Field label="Pickup / delivery notes" hint="Instructions like parking, entrance, or what to bring.">
            <Textarea
              name="pickupNotes"
              defaultValue={defaults.pickupNotes ?? ""}
              placeholder="Park in the driveway and text when you arrive."
            />
          </Field>
        </div>
      )}

      {/* How-to-find-you for live / on-site drops (no pickup window shown) */}
      {live && (
        <div className="bg-paper border border-line rounded-card p-4 sm:p-6">
          <Field
            label="How to find you"
            hint="What customers should look for when they arrive at your spot."
          >
            <Input
              name="pickupFindMe"
              defaultValue={defaults.pickupFindMe ?? ""}
              placeholder="Blue canopy near the fountain · Booth 14"
            />
          </Field>
        </div>
      )}

      {/* Items */}
      <div className="bg-paper border border-line rounded-card p-4 sm:p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-lg">{v.itemsLabel}</h2>
          <span className="text-sm text-muted">
            {rows.length} {v.itemNoun}
            {rows.length !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-sm text-muted mb-4">{v.photoHint}</p>

        {/* Saved product library — reuse items across drops */}
        {savedProducts.length > 0 && (
          <div className="mb-5">
            <button
              type="button"
              onClick={() => setLibOpen((o) => !o)}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-pill border border-line-strong bg-cream/60 hover:border-ink/30 transition"
            >
              📚 Add from saved products {libOpen ? "▲" : "▼"}
            </button>
            {libOpen && (
              <div className="mt-3 rounded-xl border border-line bg-cream/40 p-3">
                <input
                  value={libQuery}
                  onChange={(e) => setLibQuery(e.target.value)}
                  placeholder="Search your saved products…"
                  className="w-full bg-paper border border-line-strong rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                <p className="text-xs text-muted px-1 pb-2 -mt-1">
                  Adds the name, price and photos. You still set how many you&apos;re selling in
                  this drop.
                </p>
                {libMatches.length === 0 ? (
                  <p className="text-sm text-muted px-1 py-2">No matching saved products.</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto divide-y divide-line">
                    {libMatches.map((sp) => {
                      const added = usedNames.has(sp.name.trim().toLowerCase());
                      return (
                        <div key={sp.id} className="flex items-center gap-3 py-2">
                          {sp.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sp.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-line shrink-0" />
                          ) : (
                            <span className="w-10 h-10 rounded-lg bg-paper grid place-items-center text-lg shrink-0">{sp.emoji}</span>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{sp.name}</p>
                            <p className="text-xs text-muted truncate">
                              {[sp.category, sp.price ? `$${sp.price}` : ""].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={added}
                            onClick={() => addFromLibrary(sp)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-pill border border-line-strong bg-paper hover:border-brand hover:text-brand transition disabled:opacity-40 disabled:pointer-events-none shrink-0"
                          >
                            {added ? "Added" : "+ Add"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          {rows.map((row, i) => {
            return (
              <div key={row.key} className="rounded-xl border border-line p-4 bg-cream/40 space-y-4">
                {/* Photo gallery — first photo is the cover; up to {MAX} per item */}
                <div className="relative flex flex-wrap items-center gap-2">
                  {row.images.map((url, idx) => (
                    <div
                      key={url}
                      className="relative w-16 h-16 rounded-xl overflow-hidden border border-line-strong group bg-paper"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      {idx === 0 && (
                        <span className="absolute bottom-0 inset-x-0 bg-ink/70 text-white text-[9px] font-medium text-center py-0.5">
                          Cover
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImage(row.key, idx)}
                        aria-label="Remove photo"
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-ink/75 text-white text-xs grid place-items-center opacity-0 group-hover:opacity-100 transition"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {Array.from({ length: row.uploading }).map((_, k) => (
                    <div
                      key={`u${k}`}
                      className="w-16 h-16 rounded-xl border border-line-strong bg-paper grid place-items-center text-muted text-lg animate-pulse"
                    >
                      …
                    </div>
                  ))}
                  {row.images.length + row.uploading < MAX_IMAGES_PER_PRODUCT && (
                    <label className="w-16 h-16 rounded-xl border border-dashed border-line-strong bg-paper grid place-items-center cursor-pointer text-muted hover:border-brand hover:text-brand transition text-center text-[11px] leading-tight px-1">
                      {row.images.length ? "+ Add" : "📷 Photo"}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="sr-only"
                        onChange={(e) => {
                          handleFiles(row.key, e.currentTarget.files);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  )}
                  {/* Emoji fallback (used when the item has no photos) */}
                  {row.images.length === 0 && (
                    <details>
                      <summary className="list-none cursor-pointer text-xs text-muted hover:text-ink select-none flex items-center gap-1">
                        <span className="text-xl">{row.emoji}</span> Icon ▾
                      </summary>
                      <div className="absolute z-10 top-full left-0 mt-1 w-56 max-w-full grid grid-cols-8 gap-1 bg-paper border border-line rounded-xl p-2 shadow-[var(--shadow-lift)]">
                        {emojiChoices.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={(ev) => {
                              update(row.key, { emoji: e });
                              (ev.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                            }}
                            className="text-xl hover:bg-line rounded-lg p-0.5 sm:p-1 min-w-0"
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                {/* Persist this item's photo URLs, index-matched to p_name order. */}
                {row.images.map((url) => (
                  <input key={url} type="hidden" name={`p_img_${i}`} value={url} />
                ))}

                <div className="flex items-start gap-4">
                  <div className="flex-1 space-y-3 min-w-0">
                    <input type="hidden" name="p_id" value={row.id ?? ""} />
                    <input type="hidden" name="p_vpid" value={row.vendorProductId ?? ""} />
                    <input type="hidden" name="p_emoji" value={row.emoji} />
                    <input
                      name="p_name"
                      value={row.name}
                      onChange={(e) => update(row.key, { name: e.target.value })}
                      placeholder={`${v.itemPlaceholder} ${i + 1} name`}
                      className="w-full bg-paper border border-line-strong rounded-lg px-3 py-2 text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                    <input
                      name="p_desc"
                      value={row.desc}
                      onChange={(e) => update(row.key, { desc: e.target.value })}
                      placeholder="Short description (optional)"
                      className="w-full bg-paper border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                    {/*
                      Price and quantity, side by side — so each field is about
                      half a phone's width, which is 50px of usable room at
                      320px. A placeholder cannot say "how many for this drop"
                      in 50px; it just truncates to "How many f" and teaches
                      nobody anything. A LABEL can, because it wraps instead of
                      clipping. So the meaning lives in the label and the
                      placeholder stays short enough to survive any width.
                    */}
                    {/*
                      `items-stretch` + `mt-auto`: at 320px "Qty for this drop"
                      wraps to two lines while "Price" stays on one, and without
                      this the two inputs sit at different heights.
                    */}
                    <div className="flex items-stretch gap-3">
                      <div className="flex-1 min-w-0 flex flex-col">
                        <label
                          htmlFor={`${fieldId}-price-${i}`}
                          className="block text-xs font-medium text-muted mb-1"
                        >
                          Price
                        </label>
                        <div className="relative mt-auto">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                          <input
                            id={`${fieldId}-price-${i}`}
                            name="p_price"
                            value={row.price}
                            onChange={(e) => update(row.key, { price: e.target.value })}
                            inputMode="decimal"
                            placeholder="0.00"
                            aria-describedby={
                              belowMinimum(row.price) ? `${fieldId}-price-${i}-min` : undefined
                            }
                            aria-invalid={belowMinimum(row.price) || undefined}
                            className={`w-full bg-paper border rounded-lg pl-7 pr-3 py-2 text-ink placeholder:text-muted/70 focus:outline-none focus:ring-2 ${
                              belowMinimum(row.price)
                                ? "border-brand focus:border-brand focus:ring-brand/20"
                                : "border-line-strong focus:border-brand focus:ring-brand/20"
                            }`}
                          />
                        </div>
                        {/* Immediate feedback. The server refuses to publish
                            regardless — this only saves the vendor the round
                            trip. */}
                        {belowMinimum(row.price) && (
                          <p id={`${fieldId}-price-${i}-min`} className="mt-1 text-xs text-brand-dark">
                            Minimum $0.50 — payments can&apos;t be processed below that.
                          </p>
                        )}
                      </div>
                      <div
                        className="flex-1 min-w-0 flex flex-col"
                        {...(i === 0 ? { "data-guidance-anchor": "editor.inventory" } : {})}
                      >
                        <label
                          htmlFor={`${fieldId}-qty-${i}`}
                          className="block text-xs font-medium text-muted mb-1"
                        >
                          Qty for this drop
                        </label>
                        <input
                          id={`${fieldId}-qty-${i}`}
                          name="p_inventory"
                          value={row.inventory}
                          onChange={(e) => update(row.key, { inventory: e.target.value })}
                          inputMode="numeric"
                          placeholder="0"
                          className="w-full mt-auto bg-paper border border-line-strong rounded-lg px-3 py-2 text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                      </div>
                    </div>

                    {/* Collectible / non-food metadata */}
                    {meta && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <input
                          name="p_type"
                          value={row.productType}
                          onChange={(e) => update(row.key, { productType: e.target.value })}
                          placeholder="Type (e.g. Trading card)"
                          className="w-full bg-paper border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                        <input
                          name="p_condition"
                          value={row.condition}
                          onChange={(e) => update(row.key, { condition: e.target.value })}
                          placeholder="Condition (e.g. Mint)"
                          className="w-full bg-paper border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                        <input
                          name="p_rarity"
                          value={row.rarity}
                          onChange={(e) => update(row.key, { rarity: e.target.value })}
                          placeholder="Rarity / edition"
                          className="w-full bg-paper border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(row.key)}
                    className="text-muted hover:text-brand w-8 h-8 grid place-items-center rounded-lg hover:bg-line transition shrink-0"
                    aria-label={
                      row.orderCount > 0
                        ? `Remove ${v.itemNoun} (has ${row.orderCount} order${row.orderCount === 1 ? "" : "s"})`
                        : `Remove ${v.itemNoun}`
                    }
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, blankRow(defaultEmoji)])}
          className="mt-4 w-full border border-dashed border-line-strong rounded-xl py-3 text-sm font-medium text-ink-soft hover:border-brand hover:text-brand transition"
        >
          {v.addAnother}
        </button>

        {/* Auto-save new items to the reusable library (opt-out). Always submits
            "on"/"off" so the server can honor an explicit opt-out. */}
        <input type="hidden" name="saveToLibrary" value={saveToLibrary ? "on" : "off"} />
        <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={saveToLibrary}
            onChange={(e) => setSaveToLibrary(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#ff6268]"
          />
          <span className="text-sm text-ink-soft">
            Save new {v.itemNoun}s to my product library so I can reuse them in future drops.
          </span>
        </label>
      </div>

      {error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-4 py-3 -mt-2">{error}</p>
      )}

      <SaveBar mode={mode} status={defaults.status ?? "draft"} live={live} publishGate={publishGate} />
    </form>
  );
}
