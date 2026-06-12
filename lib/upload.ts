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
    const { put } = await import("@vercel/blob");
    const blob = await put(key, file, {
      access: "public",
      contentType: file.type,
    });
    return blob.url;
  }

  // Local dev: write to the public folder.
  const { mkdir, writeFile } = await import("fs/promises");
  const path = await import("path");
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  const filename = key.split("/").pop()!;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), bytes);
  return `/uploads/${filename}`;
}
