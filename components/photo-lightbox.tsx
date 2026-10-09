"use client";

import { useEffect, useState } from "react";

/* Full-screen photo viewer with prev/next, a thumbnail strip, and click-to-zoom
   so customers can inspect product photos up close. */
export function PhotoLightbox({
  images,
  name,
  index,
  onIndex,
  onClose,
}: {
  images: string[];
  name: string;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [magnified, setMagnified] = useState(false);
  const safe = Math.max(0, Math.min(index, images.length - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && safe < images.length - 1) onIndex(safe + 1);
      if (e.key === "ArrowLeft" && safe > 0) onIndex(safe - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [safe, images.length, onIndex, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} photos`}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white/90 shrink-0">
        <span className="text-sm font-medium truncate">{name}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-9 h-9 grid place-items-center rounded-full hover:bg-white/15 text-2xl leading-none"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-4 relative">
        {safe > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIndex(safe - 1); }}
            aria-label="Previous photo"
            className="absolute left-2 sm:left-4 w-11 h-11 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl"
          >
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[safe]}
          alt={`${name} photo ${safe + 1}`}
          onClick={(e) => { e.stopPropagation(); setMagnified((m) => !m); }}
          className={`max-h-full max-w-full object-contain select-none transition-transform duration-200 ${
            magnified ? "scale-150 cursor-zoom-out" : "cursor-zoom-in"
          }`}
        />
        {safe < images.length - 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIndex(safe + 1); }}
            aria-label="Next photo"
            className="absolute right-2 sm:right-4 w-11 h-11 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl"
          >
            ›
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div
          className="flex gap-2 justify-center px-4 py-4 overflow-x-auto shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => { onIndex(i); setMagnified(false); }}
              className={`w-14 h-14 rounded-lg overflow-hidden border-2 shrink-0 ${
                i === safe ? "border-white" : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
