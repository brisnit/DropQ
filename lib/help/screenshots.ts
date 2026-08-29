import manifest from "@/public/help/manifest.json";

/**
 * The generated screenshot manifest, typed.
 *
 * Written by `npm run help:screenshots` — never by hand. Importing the JSON
 * rather than hard-coding paths means an article can only reference an image
 * that was actually captured, and `npm run help:screenshots:check` can prove
 * the set is complete without rendering anything.
 */
export type HelpShot = {
  id: string;
  article: string;
  file: string;
  route: string;
  scene: string;
  viewport: "mobile" | "desktop";
  width: number;
  height: number;
  highlight: { kind: string; value?: string };
  highlightRect: { x: number; y: number; w: number; h: number };
  marker: number | null;
  caption: string;
  rewrites: string[];
  bytes: number;
  sha256: string;
};

export const HELP_SHOTS = manifest.shots as HelpShot[];
export const SHOTS_GENERATED_AT = manifest.generatedAt as string;

const BY_ID = new Map(HELP_SHOTS.map((s) => [s.id, s]));

export function shot(id: string): HelpShot | undefined {
  return BY_ID.get(id);
}

/** Does this article carry a visual walkthrough? */
export function isIllustrated(slug: string): boolean {
  return HELP_SHOTS.some((s) => s.article === slug);
}
