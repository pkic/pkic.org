import { promotionKitSchema } from "../../../../../../../shared/schemas/event-promotion-kit";
import { ApiClientError, getJson, postJson } from "../../../../../../shared/api-client";

/** Existing kits remain replica reads; a first personal link initializes through its own atomic command. */
export async function loadPromotionKit(base: string) {
  try {
    return await getJson(base, promotionKitSchema);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== "PROMOTION_REFERRAL_REQUIRED") throw error;
    return postJson(promotionResourcePath(base, "referrals"), {}, promotionKitSchema);
  }
}

/** Keeps the selected participant on every resource request in the same kit. */
export function promotionResourcePath(base: string, resource = "", query?: URLSearchParams) {
  const url = new URL(base, window.location.origin);
  if (resource) url.pathname = `${url.pathname}/${resource}`;
  query?.forEach((value, key) => url.searchParams.set(key, value));
  return `${url.pathname}${url.search}`;
}
