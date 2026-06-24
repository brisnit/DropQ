"use client";

import { compressImage } from "@/lib/compress-image";

// Reject obviously-huge originals before we even try to compress them. The
// compressor then downscales to a small WebP, and the server route enforces an
// 8MB hard cap too — so vendors can't push enormous images into a drop.
export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024; // 15MB

export class ImageTooLargeError extends Error {}

/**
 * Compress an image in the browser, then upload it (one small request each) via
 * the server upload route. Returns the public URL.
 */
export async function uploadProductImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That file isn't an image.");
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new ImageTooLargeError(
      "That image is too large (15MB max). Please use a smaller photo."
    );
  }
  const compressed = await compressImage(file);
  const form = new FormData();
  form.append("file", compressed, compressed.name || "photo.webp");

  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    let message = "Upload failed. Please try again.";
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}
