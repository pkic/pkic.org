import { z } from "zod";
/** Renderer identity is shared by image links and stored-cache metadata. */
const PERSONAL_PROMOTION_RENDERER_REVISION = 9;
export const PERSONAL_PROMOTION_RENDERER = `promotion-scene-v${PERSONAL_PROMOTION_RENDERER_REVISION}`;

/** A queued registration may survive a release; attach the current design, never an older cached card. */
export function personalPromotionRendererIsCurrent(expected: string, actual: string | undefined): boolean {
  const revision = /^promotion-scene-v(\d+)$/u.exec(expected)?.[1];
  return revision
    ? Number(revision) <= PERSONAL_PROMOTION_RENDERER_REVISION && actual === PERSONAL_PROMOTION_RENDERER
    : actual === expected;
}

export const personalPromotionImageFormatSchema = z.enum(["landscape", "square"]);
export type PersonalPromotionImageFormat = z.infer<typeof personalPromotionImageFormatSchema>;
export const PERSONAL_PROMOTION_IMAGE_DIMENSIONS = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
} as const;
export const personalPromotionImageQuerySchema = z.object({
  format: personalPromotionImageFormatSchema.default("landscape"),
  download: z.enum(["0", "1"]).optional(),
  name: z.string().max(512).optional(),
});
export function personalPromotionImageCacheKey(
  code: string,
  format: PersonalPromotionImageFormat = "landscape",
): string {
  return `og-badges/${code}${format === "square" ? "/square" : ""}`;
}
export function personalPromotionSharePath(referralCode: string): string {
  return `/r/${encodeURIComponent(referralCode)}`;
}

export function personalPromotionImagePath(
  referralCode: string,
  version?: string,
  format: PersonalPromotionImageFormat = "landscape",
): string {
  const query = new URLSearchParams({ layout: PERSONAL_PROMOTION_RENDERER });
  if (format !== "landscape") query.set("format", format);
  if (version) query.set("v", version);
  return `/api/v1/registrations/referrals/${encodeURIComponent(referralCode)}/badge?${query}`;
}
