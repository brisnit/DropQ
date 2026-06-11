"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Textarea, Select } from "@/components/ui";

type Row = {
  key: number;
  emoji: string;
  name: string;
  desc: string;
  price: string;
  inventory: string;
  imagePreview?: string;
};

const EMOJI_CHOICES = ["🍪", "🥐", "🍞", "🧁", "🎂", "🥧", "🍩", "🟤", "🍌", "🥗", "🍜", "🌮", "🍱", "🫙", "❤️", "🔥"];

let counter = 0;
const newRow = (emoji = "🍪"): Row => ({
  key: counter++,
  emoji,
  name: "",
  desc: "",
  price: "",
  inventory: "",
});

function SaveBar() {
  const { pending } = useFormStatus();
  return (
    <div className="sticky bottom-0 -mx-5 sm:-mx-8 px-5 sm:px-8 py-4 bg-cream/90 backdrop-blur border-t border-line flex items-center justify-between gap-3">
      <p className="text-sm text-muted hidden sm:block">
        You can edit everything after creating.
      </p>
      <div className="flex gap-2 ml-auto">
        <Button type="submit" name="status" value="draft" variant="secondary" disabled={pending}>
          Save as draft
        </Button>
        <Button type="submit" name="status" value="live" disabled={pending}>
          {pending ? "Publishing…" : "Publish drop"}
        </Button>
      </div>
    </div>
  );
}

export function DropEditor({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([newRow("🍪"), newRow("🥐")]);
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

  const handleFile = (key: number, file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        if (r.imagePreview) URL.revokeObjectURL(r.imagePreview);
        return { ...r, imagePreview: URL.createObjectURL(file) };
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
        return { ...r, imagePreview: undefined };
      })
    );
  };

  return (
    <form action={action} className="space-y-8">
      {/* Drop details */}
      <div className="bg-paper border border-line rounded-card p-6 space-y-5">
        <h2 className="font-semibold text-lg">Drop details</h2>
        <Field label="Title" hint="What you'd call this drop in a story or text.">
          <Input name="title" placeholder="Friday Cookie Drop — Brown Butter Week" required />
        </Field>
        <Field label="Description">
          <Textarea name="description" placeholder="Tell customers what's special this week, and any details they should know." />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Fulfillment">
            <Select name="fulfillment" defaultValue="pickup">
              <option value="pickup">Pickup</option>
              <option value="delivery">Local delivery</option>
              <option value="shipping">Shipping</option>
            </Select>
          </Field>
          <Field label="Pickup / delivery details">
            <Input name="pickupInfo" placeholder="Fri 4–6pm · 2118 E Cesar Chavez" />
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Opens" hint="Optional — when ordering starts.">
            <Input name="opensAt" type="datetime-local" />
          </Field>
          <Field label="Closes" hint="Optional — last call for orders.">
            <Input name="closesAt" type="datetime-local" />
          </Field>
        </div>
      </div>

      {/* Items */}
      <div className="bg-paper border border-line rounded-card p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-lg">Menu items</h2>
          <span className="text-sm text-muted">{rows.length} item{rows.length !== 1 ? "s" : ""}</span>
        </div>
        <p className="text-sm text-muted mb-5">
          Add a real photo of each item, or pick an icon. Photos sell food best.
        </p>

        <div className="space-y-4">
          {rows.map((row, i) => (
            <div key={row.key} className="rounded-xl border border-line p-4 bg-cream/40">
              <div className="flex items-start gap-4">
                {/* Media: photo upload + emoji fallback */}
                <div className="flex flex-col items-center gap-1.5 w-16 shrink-0">
                  <label className="relative w-16 h-16 rounded-xl overflow-hidden border border-line-strong bg-paper grid place-items-center cursor-pointer group">
                    {row.imagePreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.imagePreview} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl">{row.emoji}</span>
                    )}
                    <span className="absolute inset-0 bg-ink/45 text-white text-[11px] font-medium grid place-items-center opacity-0 group-hover:opacity-100 transition">
                      {row.imagePreview ? "Change" : "📷 Photo"}
                    </span>
                    {/* Always-present file input keeps row alignment on submit */}
                    <input
                      ref={(el) => {
                        fileRefs.current[row.key] = el;
                      }}
                      type="file"
                      name="p_image"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => handleFile(row.key, e.target.files?.[0])}
                    />
                  </label>

                  {row.imagePreview ? (
                    <button
                      type="button"
                      onClick={() => removePhoto(row.key)}
                      className="text-[11px] text-muted hover:text-brand"
                    >
                      Remove
                    </button>
                  ) : (
                    <details className="relative">
                      <summary className="list-none cursor-pointer text-[11px] text-muted hover:text-ink select-none">
                        Icon ▾
                      </summary>
                      <div className="absolute z-10 mt-1 left-1/2 -translate-x-1/2 w-56 grid grid-cols-8 gap-1 bg-paper border border-line rounded-xl p-2 shadow-[var(--shadow-lift)]">
                        {EMOJI_CHOICES.map((e) => (
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

                {/* Fields */}
                <div className="flex-1 space-y-3 min-w-0">
                  <input type="hidden" name="p_emoji" value={row.emoji} />
                  <input
                    name="p_name"
                    value={row.name}
                    onChange={(e) => update(row.key, { name: e.target.value })}
                    placeholder={`Item ${i + 1} name`}
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
                </div>

                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  className="text-muted hover:text-brand w-8 h-8 grid place-items-center rounded-lg hover:bg-line transition shrink-0"
                  aria-label="Remove item"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, newRow()])}
          className="mt-4 w-full border border-dashed border-line-strong rounded-xl py-3 text-sm font-medium text-ink-soft hover:border-brand hover:text-brand transition"
        >
          + Add another item
        </button>
      </div>

      <SaveBar />
    </form>
  );
}
