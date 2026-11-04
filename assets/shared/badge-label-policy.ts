import type { BadgePrintingContext } from "./schemas/route-contracts-event-badges";

/** Labels contain live attendee details only; changes to preprinted artwork cannot invalidate them. */
export const BADGE_LABEL_PRINTING_CONTEXT: BadgePrintingContext = {
  revision: "0".repeat(64),
  template: null,
  branding: [],
};

export const BADGE_LABEL_COPY_OPTIONS = [1, 2, 3, 4] as const;
export const BADGE_LABEL_DEFAULT_COPIES = 2;

/** Brother's raster reference: DK-1208 native page and nonprintable edge offsets, in mm. */
export const BROTHER_DK_1208_PAPER = {
  widthMm: 38,
  heightMm: 89.8,
  crossFeedMarginMm: 1.5,
  feedMarginMm: 3,
} as const;

export function isBrotherDk1208Paper(paper: { widthMm: number; heightMm: number }): boolean {
  return paper.widthMm === BROTHER_DK_1208_PAPER.widthMm && paper.heightMm === BROTHER_DK_1208_PAPER.heightMm;
}
