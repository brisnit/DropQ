"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";

function UploadButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      className="inline-flex items-center justify-center font-medium rounded-xl text-[0.95rem] px-5 py-2.5 bg-brand text-white hover:bg-brand-dark disabled:opacity-50 transition"
    >
      {pending
        ? "Uploading…"
        : count > 0
          ? `Upload ${count} photo${count !== 1 ? "s" : ""}`
          : "Select photos to upload"}
    </button>
  );
}

export function GalleryUpload({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  const onChange = (files: FileList | null) => {
    previews.forEach((p) => URL.revokeObjectURL(p));
    const arr = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    setPreviews(arr.map((f) => URL.createObjectURL(f)));
  };

  return (
    <form action={action} className="space-y-3">
      <label className="block border border-dashed border-line-strong rounded-xl p-5 text-center cursor-pointer hover:border-brand transition">
        <input
          ref={ref}
          type="file"
          name="galleryImages"
          accept="image/png,image/jpeg,image/webp,image/avif"
          multiple
          className="sr-only"
          onChange={(e) => onChange(e.target.files)}
        />
        <span className="text-sm font-medium text-ink-soft">📷 Choose photos</span>
        <p className="text-xs text-muted mt-1">
          JPG, PNG, WebP or AVIF · up to 8MB each. Square crops look best.
        </p>
      </label>

      {previews.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {previews.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt=""
              className="w-full aspect-square object-cover rounded-lg border border-line"
            />
          ))}
        </div>
      )}

      <UploadButton count={previews.length} />
    </form>
  );
}
