import { promotionKitSchema } from "../../../../../../../shared/schemas/event-promotion-kit";
import { ApiClientError, getJson, postJson } from "../../../../../../shared/api-client";

/** Existing kits remain replica reads; a first personal link initializes through its own atomic command. */
export async function loadPromotionKit(base: string) {
  try {
    return await getJson(base, promotionKitSchema);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== "PROMOTION_REFERRAL_REQUIRED") throw error;
    return postJson(`${base}/referrals`, {}, promotionKitSchema);
  }
}
