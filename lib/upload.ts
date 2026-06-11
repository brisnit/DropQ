import "server-only";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/**
 * Persist an uploaded image to /public/uploads and return its public URL.
 * Returns null if the value is empty or not a valid image.
 */
export async function saveImage(value: FormDataEntryValue | null): Promise<string | null> {
  if (!value || typeof value === "string") return null;
  const file = value as File;
  if (!file.size) return null;
  if (file.size > MAX_BYTES) return null;
  const ext = EXT[file.type];
  if (!ext) return null;

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), bytes);
  return `/uploads/${filename}`;
}
