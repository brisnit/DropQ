"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Textarea, Select } from "@/components/ui";
import { vocab, showItemMeta, isFood } from "@/lib/category";
import { compressImage, setInputFiles } from "@/lib/compress-image";

export type DropDefaults = {
  title?: string;
  description?: string;
  fulfillment?: string;
  location?: string;
  opensAt?: string; // "YYYY-MM-DDTHH:mm"
  closesAt?: string;
  status?: string;
  products?: Array<{
    id?: string;
    emoji?: string;
    name?: string;
    desc?: string;
    price?: string;
    inventory?: string;
    imageUrl?: string | null;
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
  imageUrl?: string | null; // existing photo (edit)
  imagePreview?: string; // new local preview
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
}: {
  action: (formData: FormData) => void | Promise<void>;
  mode?: "create" | "edit";
  defaults?: DropDefaults;
  dropId?: string;
  category?: string;
  dropMode?: "preorder" | "live";
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
          imageUrl: p.imageUrl ?? null,
        }))
      : [blankRow(defaultEmoji), blankRow(defaultEmoji)];

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const remove = (key: number) =>
    setRows((rs) => {
      if (rs.length <= 1) return rs;
      const row = rs.find((r) => r.key === key);
      if (row?.imagePreview) URL.revokeObjectURL(row.imagePreview);
      return rs.filter((r) => r.key !== key);
    });

  const handleFile = async (key: number, input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const compressed = await compressImage(file);
    setInputFiles(input, [compressed]);
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        if (r.imagePreview) URL.revokeObjectURL(r.imagePreview);
        return { ...r, imagePreview: URL.createObjectURL(compressed) };
      })
    );
  };

  const removePhoto = (key: number) => {
    const input = fileRefs.current[key];
    if (input) input.value = "";
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        if (r.imagePreview) URL.revokeObjectURL(r.imagePreview);
        return { ...r, imagePreview: undefined, imageUrl: null };
      })
    );
  };

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
          <p className="text-sm rounded-xl bg-quad/10 text-tertiary px-4 py-3">
            🟢 Live selling mode — customers scan your QR and order on the spot. Orders appear in your dashboard in real time.
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
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Opens" hint="When ordering starts.">
              <Input name="opensAt" type="datetime-local" defaultValue={defaults.opensAt ?? ""} required />
            </Field>
            <Field label="Closes" hint="Last call for orders.">
              <Input name="closesAt" type="datetime-local" defaultValue={defaults.closesAt ?? ""} required />
            </Field>
          </div>
        )}
      </div>

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
            const shownImage = row.imagePreview || row.imageUrl || null;
            return (
              <div key={row.key} className="rounded-xl border border-line p-4 bg-cream/40">
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center gap-1.5 w-16 shrink-0">
                    <label className="relative w-16 h-16 rounded-xl overflow-hidden border border-line-strong bg-paper grid place-items-center cursor-pointer group">
                      {shownImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={shownImage} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">{row.emoji}</span>
                      )}
                      <span className="absolute inset-0 bg-ink/45 text-white text-[11px] font-medium grid place-items-center opacity-0 group-hover:opacity-100 transition">
                        {shownImage ? "Change" : "📷 Photo"}
                      </span>
                      <input
                        ref={(el) => {
                          fileRefs.current[row.key] = el;
                        }}
                        type="file"
                        name="p_image"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => handleFile(row.key, e.currentTarget)}
                      />
                    </label>
                    {shownImage ? (
                      <button type="button" onClick={() => removePhoto(row.key)} className="text-[11px] text-muted hover:text-brand">
                        Remove
                      </button>
                    ) : (
                      <details className="relative">
                        <summary className="list-none cursor-pointer text-[11px] text-muted hover:text-ink select-none">Icon ▾</summary>
                        <div className="absolute z-10 mt-1 left-1/2 -translate-x-1/2 w-56 grid grid-cols-8 gap-1 bg-paper border border-line rounded-xl p-2 shadow-[var(--shadow-lift)]">
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

                  <div className="flex-1 space-y-3 min-w-0">
                    <input type="hidden" name="p_id" value={row.id ?? ""} />
                    <input type="hidden" name="p_emoji" value={row.emoji} />
                    <input type="hidden" name="p_keep_image" value={row.imageUrl ?? ""} />
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
