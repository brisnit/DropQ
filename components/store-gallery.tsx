"use client";

import { useState } from "react";
import { PhotoLightbox } from "@/components/photo-lightbox";

/**
 * A vendor's storefront gallery, with the photos openable full screen.
 *
 * Uses the same viewer the drop page already uses for product photos — same
 * prev/next, same thumbnail strip, same pinch-to-magnify — rather than a
 * second implementation that would drift. A customer deciding whether to buy
 * wants to look closely at what they are buying, and the gallery was the one
 * place on a storefront where clicking a photo did nothing.
 */
export function StoreGallery({ images }: { images: { id: string; url: string }[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const urls = images.map((i) => i.url);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {images.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Open photo ${i + 1} of ${images.length} full screen`}
            className="group relative block w-full aspect-square overflow-hidden rounded-card border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tertiary/60"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt=""
              className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            />
          </button>
        ))}
      </div>

      {index !== null && (
        <PhotoLightbox
          images={urls}
          name="Gallery"
          index={index}
          onIndex={setIndex}
          onClose={() => setIndex(null)}
        />
      )}
    </>
  );
}
