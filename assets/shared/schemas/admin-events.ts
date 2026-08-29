import { successResponseSchema } from "./api-common";
import { z } from "zod";
import { EVENT_PROPOSALS_SORT_COLUMNS } from "./event-proposals";

export { EVENT_PROPOSALS_SORT_COLUMNS };

export const adminWaitlistPromotionResponseSchema = successResponseSchema.extend({
  dayRegistrationOffers: z.number().int().nonnegative(),
  affectedRegistrations: z.array(z.string()),
});
