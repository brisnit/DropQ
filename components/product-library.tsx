"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { EmptyState } from "@/components/dashboard-ui";
import { uploadImage, ImageTooLargeError } from "@/lib/upload-client";
import {
  createVendorProductAction,
  updateVendorProductAction,
  toggleVendorProductAction,
  deleteVendorProductAction,
  type ProductSaveState,
} from "@/lib/actions/products";
import { ConfirmSubmit } from "@/components/confirm-submit";

export type LibProduct = {
  id: string;
  name: string;
  description: string | null;
  priceDollars: string;
  emoji: string;
  imageUrl: string | null;
  images: string[];
  category: string | null;
  allergens: string | null;
  isActive: boolean;
};

const EMOJIS = ["🍪", "🥐", "🍞", "🧁", "🎂", "🥧", "🍩", "🍰", "🥗", "🍜", "🌮", "☕", "🥤", "🫙", "📦", "✨"];
const MAX_IMAGES = 6;

function SaveBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** Shared create/edit form. `product` present ⇒ edit mode. */
function ProductForm({
  product,
  onDone,
}: {
  product?: LibProduct;
  onDone?: () => void;
}) {
  const action = product ? updateVendorProductAction : createVendorProductAction;
  const [state, formAction] = useActionState<ProductSaveState, FormData>(action, {});
  const [emoji, setEmoji] = useState(product?.emoji ?? "🍪");
  const [images, setImages] = useState<string[]>(
    product?.images?.length ? product.images : product?.imageUrl ? [product.imageUrl] : []
  );
  const [uploading, setUploading] = useState(0);
  const [imgError, setImgError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const room = MAX_IMAGES - images.length;
    const toUpload = list.slice(0, Math.max(0, room));
    if (!toUpload.length) return;
    setUploading((n) => n + toUpload.length);
    await Promise.all(
      toUpload.map(async (file) => {
        try {
          const url = await uploadImage(file);
          setImages((imgs) => [...imgs, url]);
        } catch (e) {
          setImgError(e instanceof ImageTooLargeError ? e.message : "Couldn't upload that image.");
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      })
    );
  };

  return (
    <form action={formAction} className="space-y-4">
      {product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="emoji" value={emoji} />
      {images.map((url) => (
        <input key={url} type="hidden" name="images" value={url} />
      ))}

      {/* Photos + emoji */}
      <div className="relative flex flex-wrap items-center gap-2">
        {images.map((url, idx) => (
          <div key={url} className="relative w-16 h-16 rounded-xl overflow-hidden border border-line-strong group bg-paper">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="w-full h-full object-cover" />
            {idx === 0 && (
              <span className="absolute bottom-0 inset-x-0 bg-ink/70 text-white text-[9px] text-center py-0.5">Cover</span>
            )}
            <button
              type="button"
              onClick={() => setImages((imgs) => imgs.filter((_, i) => i !== idx))}
              aria-label="Remove photo"
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-ink/75 text-white text-xs grid place-items-center opacity-0 group-hover:opacity-100 transition"
            >
              ✕
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }).map((_, k) => (
          <div key={`u${k}`} className="w-16 h-16 rounded-xl border border-line-strong bg-paper grid place-items-center text-muted animate-pulse">…</div>
        ))}
        {images.length + uploading < MAX_IMAGES && (
          <label className="w-16 h-16 rounded-xl border border-dashed border-line-strong bg-paper grid place-items-center cursor-pointer text-muted hover:border-brand hover:text-brand transition text-center text-[11px] leading-tight px-1">
            {images.length ? "+ Add" : "📷 Photo"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                handleFiles(e.currentTarget.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
        )}
        <details>
          <summary className="list-none cursor-pointer text-xs text-muted hover:text-ink select-none flex items-center gap-1">
            <span className="text-xl">{emoji}</span> Icon ▾
          </summary>
          <div className="absolute z-10 top-full left-0 mt-1 w-56 max-w-full grid grid-cols-8 gap-1 bg-paper border border-line rounded-xl p-2 shadow-[var(--shadow-lift)]">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={(ev) => {
                  setEmoji(e);
                  (ev.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                }}
                className="text-xl hover:bg-line rounded-lg p-0.5 sm:p-1 min-w-0"
              >
                {e}
              </button>
            ))}
          </div>
        </details>
      </div>
      {imgError && <p className="text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">{imgError}</p>}

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name">
          <Input name="name" defaultValue={product?.name ?? ""} placeholder="Rich chocolate chip brownies" required />
        </Field>
        <Field label="Default price" hint="You can override this per drop.">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
            <Input name="price" defaultValue={product?.priceDollars ?? ""} inputMode="decimal" placeholder="0.00" className="pl-7" />
          </div>
        </Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Category" hint="Optional — e.g. Pastries, Drinks.">
          <Input name="category" defaultValue={product?.category ?? ""} placeholder="Pastries" />
        </Field>
        <Field label="Allergens / dietary notes" hint="Optional.">
          <Input name="allergens" defaultValue={product?.allergens ?? ""} placeholder="Contains nuts, gluten" />
        </Field>
      </div>
      <Field label="Description">
        <Textarea name="description" defaultValue={product?.description ?? ""} placeholder="Short description customers will see." />
      </Field>

      <div className="flex items-center gap-3">
        <SaveBtn label={product ? "Save changes" : "Add to library"} />
        {product && onDone && (
          <button type="button" onClick={onDone} className="text-sm text-muted hover:text-ink">
            Cancel
          </button>
        )}
        {state.saved && <span className="text-sm text-sage font-medium">✓ Saved</span>}
        {state.error && <span className="text-sm text-brand-dark">{state.error}</span>}
      </div>
    </form>
  );
}

export function ProductLibrary({ products }: { products: LibProduct[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Add new */}
      <div className="bg-paper border border-line rounded-card p-6">
        {adding ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">New product</h2>
              <button onClick={() => setAdding(false)} className="text-sm text-muted hover:text-ink">
                Close
              </button>
            </div>
            <ProductForm onDone={() => setAdding(false)} />
          </>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full border border-dashed border-line-strong rounded-xl py-3 text-sm font-medium text-ink-soft hover:border-brand hover:text-brand transition"
          >
            + Add a product
          </button>
        )}
      </div>

      {/* List */}
      {products.length === 0 ? (
        <EmptyState
          emoji="📚"
          title="Your reusable products live here"
          body="Save the things you sell often, then drop them into any future drop instead of typing them again. Anything you create inside a drop is saved here automatically."
          note="Price and photos come from here; how many you're selling is set per drop, so this list never holds a stock count."
        />
      ) : (
        <div className="space-y-3">
          {products.map((p) =>
            editingId === p.id ? (
              <div key={p.id} className="bg-paper border border-line rounded-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold">Edit product</h2>
                </div>
                <ProductForm product={p} onDone={() => setEditingId(null)} />
              </div>
            ) : (
              <div
                key={p.id}
                className={`bg-paper border border-line rounded-card p-4 flex items-center gap-4 ${
                  p.isActive ? "" : "opacity-60"
                }`}
              >
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt={p.name} className="w-14 h-14 rounded-xl object-cover border border-line shrink-0" />
                ) : (
                  <span className="w-14 h-14 rounded-xl bg-cream grid place-items-center text-2xl shrink-0">{p.emoji}</span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {p.name}
                    {!p.isActive && <span className="ml-2 text-xs text-muted">(inactive)</span>}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {[p.category, p.priceDollars ? `$${p.priceDollars}` : "", p.allergens]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setEditingId(p.id)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-line-strong bg-paper hover:border-ink/30 transition"
                  >
                    Edit
                  </button>
                  <form action={toggleVendorProductAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="active" value={p.isActive ? "0" : "1"} />
                    <button
                      type="submit"
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-line-strong bg-paper hover:border-ink/30 transition"
                    >
                      {p.isActive ? "Hide" : "Activate"}
                    </button>
                  </form>
                  <form action={deleteVendorProductAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmSubmit
                      message={`Delete “${p.name}” from your library? Existing drops keep their copy.`}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-line text-muted hover:text-white hover:bg-brand hover:border-brand transition"
                    >
                      Delete
                    </ConfirmSubmit>
                  </form>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
