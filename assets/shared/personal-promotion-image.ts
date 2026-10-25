/** Renderer identity is shared by image links and stored-cache metadata. */
export const PERSONAL_PROMOTION_RENDERER = "promotion-scene-v4";

export function personalPromotionSharePath(referralCode: string): string {
  return `/r/${encodeURIComponent(referralCode)}`;
}

export function personalPromotionImagePath(referralCode: string, version?: string): string {
  const query = new URLSearchParams({ layout: PERSONAL_PROMOTION_RENDERER });
  if (version) query.set("v", version);
  return `/api/v1/registrations/referrals/${encodeURIComponent(referralCode)}/badge?${query}`;
}
