// Vendor brand-color utilities.
//
// Vendors pick any brand color, but light colors (e.g. #BFD3DE) make terrible
// CTA buttons — white text on them is unreadable. This derives an accessible
// CTA color from the vendor's brand color by darkening it (in HSL, so the hue
// is preserved and brand identity is kept) only as much as needed to clear the
// WCAG AA 4.5:1 contrast bar against white text. The vendor's original brand
// color is never mutated — the CTA color is a derived value.
//
// Pure module (no server-only): safe to import in both server and client code.

export type Rgb = { r: number; g: number; b: number };

/** WCAG AA contrast for normal text. */
export const AA_CONTRAST = 4.5;

// DropQ's coral — the safe fallback when a vendor color is missing/invalid.
const FALLBACK_BRAND = "#ff6268";
// A guaranteed-accessible CTA fallback (passes 4.5:1 on white).
const FALLBACK_CTA = "#1a1a1a";

/** Parse "#rgb" / "#rrggbb" (with or without #) → {r,g,b}, or null if invalid. */
export function hexToRgb(hex: string): Rgb | null {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** {r,g,b} (0–255, clamped/rounded) → "#rrggbb". */
export function rgbToHex({ r, g, b }: Rgb): string {
  const to2 = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** WCAG relative luminance (0–1) of an sRGB color. */
export function getRelativeLuminance(rgb: Rgb): number {
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b);
}

/** WCAG contrast ratio (1–21) between two hex colors. Invalid input → 1. */
export function getContrastRatio(hex1: string, hex2: string): number {
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  if (!a || !b) return 1;
  const la = getRelativeLuminance(a);
  const lb = getRelativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/* --------------------------- HSL round-trip ----------------------------- */
type Hsl = { h: number; s: number; l: number }; // h 0–360, s/l 0–1

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rr: h = (gg - bb) / d + (gg < bb ? 6 : 0); break;
      case gg: h = (bb - rr) / d + 2; break;
      default: h = (rr - gg) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = ((h % 360) + 360) % 360 / 360;
  const t = (n: number) => {
    let x = hk + n;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: t(1 / 3) * 255, g: t(0) * 255, b: t(-1 / 3) * 255 };
}

/**
 * Darken a hex color by reducing its HSL lightness by `amount` (0–1), preserving
 * hue and saturation so the color stays recognizably on-brand. Invalid input
 * falls back to the safe CTA color.
 */
export function darkenColor(hex: string, amount = 0.1): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return FALLBACK_CTA;
  const hsl = rgbToHsl(rgb);
  hsl.l = Math.max(0, hsl.l - amount);
  return rgbToHex(hslToRgb(hsl));
}

/** Lighten a hex color (HSL lightness up). Used for subtle brand tints. */
export function lightenColor(hex: string, amount = 0.1): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return FALLBACK_BRAND;
  const hsl = rgbToHsl(rgb);
  hsl.l = Math.min(1, hsl.l + amount);
  return rgbToHex(hslToRgb(hsl));
}

/** Whichever of white/black has the higher contrast on `hex` (ties → white). */
export function bestTextColor(hex: string): "#ffffff" | "#111111" {
  return getContrastRatio(hex, "#ffffff") >= getContrastRatio(hex, "#111111")
    ? "#ffffff"
    : "#111111";
}

/**
 * Derive an accessible CTA color from a vendor brand color.
 *  1. Accept a hex color.
 *  2. Test contrast against #FFFFFF.
 *  3. If it already clears AA (>= 4.5), use it directly.
 *  4. Otherwise darken incrementally (HSL lightness, hue preserved)…
 *  5. …stopping the moment contrast passes 4.5 — so we darken the *least*
 *     amount needed and stay as close to the brand color as possible.
 *  6. Return the adjusted CTA hex. Invalid input → safe fallback.
 */
export function generateAccessibleCtaColor(
  hex: string,
  target = AA_CONTRAST
): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return FALLBACK_CTA;

  const clean = rgbToHex(rgb);
  if (getContrastRatio(clean, "#ffffff") >= target) return clean;

  const hsl = rgbToHsl(rgb);
  // Step down lightness in 2% increments; black (l=0) always clears 4.5:1,
  // so this is guaranteed to terminate.
  for (let l = hsl.l; l >= 0; l -= 0.02) {
    const candidate = rgbToHex(hslToRgb({ ...hsl, l: Math.max(0, l) }));
    if (getContrastRatio(candidate, "#ffffff") >= target) return candidate;
  }
  return "#000000";
}

export type VendorPalette = {
  vendor_brand_color: string; // original, unchanged
  vendor_cta_color: string; // accessible, derived
  vendor_cta_hover_color: string; // slightly darker for hover
  vendor_cta_text_color: string; // white, or black if white fails
  vendor_brand_light_color: string; // soft tint for backgrounds/badges
};

/**
 * Full derived palette for a vendor brand color. The brand color is preserved
 * for display; the CTA color is the accessible derivative used on buttons.
 */
export function vendorPalette(brand?: string | null): VendorPalette {
  const safeBrand = brand && hexToRgb(brand) ? rgbToHex(hexToRgb(brand)!) : FALLBACK_BRAND;
  const cta = generateAccessibleCtaColor(safeBrand);
  return {
    vendor_brand_color: safeBrand,
    vendor_cta_color: cta,
    vendor_cta_hover_color: darkenColor(cta, 0.08),
    vendor_cta_text_color: getContrastRatio(cta, "#ffffff") >= AA_CONTRAST ? "#ffffff" : bestTextColor(cta),
    vendor_brand_light_color: lightenColor(safeBrand, 0.28),
  };
}

/** Convenience: just the accessible CTA background for a brand color. */
export function ctaColor(brand?: string | null): string {
  return vendorPalette(brand).vendor_cta_color;
}
