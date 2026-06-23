// Client-side image downscale + compress. Runs in the browser before upload so
// large phone photos don't blow past Vercel's ~4.5MB serverless request limit
// (and storefront images stay small + fast). Outputs WebP (keeps transparency).

export async function compressImage(
  file: File,
  maxDim = 1600,
  quality = 0.82
): Promise<File> {
  if (typeof document === "undefined") return file;
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    let w = bitmap.width;
    let h = bitmap.height;
    const longest = Math.max(w, h);
    if (longest > maxDim) {
      const s = maxDim / longest;
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/webp", quality)
    );
    // WebP unsupported, or compression made it bigger — keep the original.
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], name, { type: "image/webp", lastModified: Date.now() });
  } catch {
    // Undecodable (e.g., some HEIC on non-Safari) — fall back to the original.
    return file;
  }
}

/** Replace the file an <input type="file"> will submit (so the form sends ours). */
export function setInputFiles(input: HTMLInputElement, files: File[]): void {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
}
