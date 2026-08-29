import { eventSlugParamsSchema } from "./api-common";
import { adminWaitlistPromotionResponseSchema } from "./admin-events";

export const adminWaitlistPromotionRouteSchema = {
  tags: ["Admin events"],
  summary: "Promote waitlisted registrations",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Waitlist promotions processed.",
      content: { "application/json": { schema: adminWaitlistPromotionResponseSchema } },
    },
  },
};
