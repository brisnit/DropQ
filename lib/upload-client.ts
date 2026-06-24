"use client";

import { upload } from "@vercel/blob/client";
import { compressImage } from "@/lib/compress-image";

// Reject obviously-huge originals before we even try to compress them. The
// compressor then downscales to a small WebP, and the server route enforces a
// hard cap too — so vendors can't push enormous images into a drop.
export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024; // 15MB

export class ImageTooLargeError extends Error {}

/**
 * Compress an image in the browser and upload it straight to Vercel Blob
 * (bypassing the serverless request-body limit). Returns the public URL.
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
  const name = (compressed.name || "photo.webp").replace(/[^\w.\-]+/g, "_");
  const blob = await upload(name, compressed, {
    access: "public",
    handleUploadUrl: "/api/blob/upload",
    contentType: compressed.type,
  });
  return blob.url;
}
