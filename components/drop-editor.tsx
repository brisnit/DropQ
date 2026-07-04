"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Textarea, Select } from "@/components/ui";
import { vocab, showItemMeta, isFood } from "@/lib/category";
import { uploadImage, ImageTooLargeError } from "@/lib/upload-client";
import { DateRangePicker } from "@/components/date-range-picker";
import { AddressAutocomplete } from "@/components/address-autocomplete";

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
  status?: string;
  products?: Array<{
    id?: string;
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
  }>;
};

type Row = {
  key: number;
  id?: string;
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
});

function SaveBar({
  mode,
  status,
  live,
}: {
  mode: "create" | "edit";
  status: string;
  live: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="sticky bottom-0 -mx-5 sm:-mx-8 px-5 sm:px-8 py-4 bg-cream/90 backdrop-blur border-t border-line flex items-center justify-between gap-3">
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
  timeZone,
}: {
  action: (formData: FormData) => void | Promise<void>;
  mode?: "create" | "edit";
  defaults?: DropDefaults;
  dropId?: string;
  category?: string;
  dropMode?: "preorder" | "live";
  timeZone?: string;
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
        }))
      : [blankRow(defaultEmoji), blankRow(defaultEmoji)];

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [error, setError] = useState<string | null>(null);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const remove = (key: number) =>
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.key !== key)));

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
      const opens = String(fd.get("opensAt") ?? "");
      const closes = String(fd.get("closesAt") ?? "");
      if (!opens || !closes) {
        e.preventDefault();
        setError("Please set both an open and a close date/time.");
        return;
      }
      if (closes <= opens) {
        e.preventDefault();
        setError("Close date/time must be after the open date/time.");
        return;
      }
      // Pickup window is optional, but if set it must be consistent (ISO
      // instants compare chronologically as strings).
      const pStart = String(fd.get("pickupStartAt") ?? "");
      const pEnd = String(fd.get("pickupEndAt") ?? "");
      if ((pStart && !pEnd) || (!pStart && pEnd)) {
        e.preventDefault();
        setError("Set both a pickup start and end time, or leave both blank.");
        return;
      }
      if (pStart && pEnd) {
        if (pEnd <= pStart) {
          e.preventDefault();
          setError("Pickup end must be after pickup start.");
          return;
        }
        if (pStart < closes) {
          e.preventDefault();
          setError("Pickup can't start before ordering closes.");
          return;
        }
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
      <div className="bg-paper border border-line rounded-card p-6 space-y-5">
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
            <p className="text-sm font-medium text-ink mb-1">Order window</p>
            <p className="text-sm text-muted mb-3">
              When ordering opens and closes. Ordering locks automatically at the close time.
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
        <div className="bg-paper border border-line rounded-card p-6 space-y-5">
          <div>
            <h2 className="font-semibold text-lg">Pickup</h2>
            <p className="text-sm text-muted mt-0.5">
              When and where customers pick up (or receive) their orders after ordering closes.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-ink mb-1">Pickup window</p>
            <p className="text-sm text-muted mb-3">Must start on or after your order close time.</p>
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

      {/* Items */}
      <div className="bg-paper border border-line rounded-card p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-lg">{v.itemsLabel}</h2>
          <span className="text-sm text-muted">
            {rows.length} {v.itemNoun}
            {rows.length !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-sm text-muted mb-5">{v.photoHint}</p>

        <div className="space-y-4">
          {rows.map((row, i) => {
            return (
              <div key={row.key} className="rounded-xl border border-line p-4 bg-cream/40 space-y-4">
                {/* Photo gallery — first photo is the cover; up to {MAX} per item */}
                <div className="flex flex-wrap items-center gap-2">
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
                    <details className="relative">
                      <summary className="list-none cursor-pointer text-xs text-muted hover:text-ink select-none flex items-center gap-1">
                        <span className="text-xl">{row.emoji}</span> Icon ▾
                      </summary>
                      <div className="absolute z-10 mt-1 w-56 grid grid-cols-8 gap-1 bg-paper border border-line rounded-xl p-2 shadow-[var(--shadow-lift)]">
                        {emojiChoices.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={(ev) => {
                              update(row.key, { emoji: e });
                              (ev.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                            }}
                            className="text-xl hover:bg-line rounded-lg p-1"
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
                    <div className="flex gap-3">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                        <input
                          name="p_price"
                          value={row.price}
                          onChange={(e) => update(row.key, { price: e.target.value })}
                          inputMode="decimal"
                          placeholder="0.00"
                          className="w-full bg-paper border border-line-strong rounded-lg pl-7 pr-3 py-2 text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                      </div>
                      <div className="relative flex-1">
                        <input
                          name="p_inventory"
                          value={row.inventory}
                          onChange={(e) => update(row.key, { inventory: e.target.value })}
                          inputMode="numeric"
                          placeholder="Qty available"
                          className="w-full bg-paper border border-line-strong rounded-lg px-3 py-2 text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
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
                    aria-label={`Remove ${v.itemNoun}`}
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
      </div>

      {error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-4 py-3 -mt-2">{error}</p>
      )}

      <SaveBar mode={mode} status={defaults.status ?? "draft"} live={live} />
    </form>
  );
}
