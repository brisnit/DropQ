import "server-only";
import { randomUUID } from "crypto";

const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/**
 * Persist an uploaded image and return its public URL.
 * - In production / on Vercel (BLOB_READ_WRITE_TOKEN set): uploads to Vercel Blob.
 * - In local dev (no token): writes to /public/uploads and serves from /uploads.
 * Returns null if the value is empty or not a valid image.
 */
export async function saveImage(value: FormDataEntryValue | null): Promise<string | null> {
  if (!value || typeof value === "string") return null;
  const file = value as File;
  if (!file.size) return null;
  if (file.size > MAX_BYTES) return null;
  const ext = EXT[file.type];
  if (!ext) return null;

  const key = `uploads/${randomUUID()}.${ext}`;

  // Production: object storage (works on Vercel's read-only filesystem).
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import("@vercel/blob");
      const blob = await put(key, file, {
        access: "public",
        contentType: file.type,
      });
      return blob.url;
    } catch (e) {
      // Never crash the page/server action over a failed upload — skip the image.
      console.error("Blob upload failed:", e);
      return null;
    }
  }

  // No Blob token. The filesystem is read-only on Vercel, so writing there would
  // throw a 500 — skip it (and log how to fix) instead of crashing the save.
  if (process.env.VERCEL) {
    console.error(
      "Image upload skipped: BLOB_READ_WRITE_TOKEN is not set. Create a Vercel Blob store and connect it to this project to enable uploads."
    );
    return null;
  }

  // Local dev: write to the public folder.
  try {
    const { mkdir, writeFile } = await import("fs/promises");
    const path = await import("path");
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    const filename = key.split("/").pop()!;
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, filename), bytes);
    return `/uploads/${filename}`;
  } catch (e) {
    console.error("Local image write failed:", e);
    return null;
  }
}
