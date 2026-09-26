import {
  donationPromotersListResponseSchema,
  donationPromotersListRouteSchema,
} from "../../../../assets/shared/schemas/donation-management";
import {
  donationPromoterPostRouteSchema,
  donationPromoterResponseSchema,
} from "../../../../assets/shared/schemas/donation";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listDonationPromoters } from "../../../_lib/services/donations";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { getOrCreateDonationPromoter } from "../../../_lib/services/donations/promoter";

export const DonationPromotersCreate = openApiRoute(donationPromoterPostRouteSchema, async (c: AdminContext, data) => {
  const promoter = await getOrCreateDonationPromoter(
    c.env.DB,
    data.body.sessionId,
    resolveAppBaseUrl(c.env, c.req.raw),
  );
  if (!promoter) {
    return json({ error: { code: "NOT_FOUND", message: "Completed donation not found for this session" } }, 404);
  }
  return json(donationPromoterResponseSchema.parse(promoter));
});

export const DonationPromotersList = openApiRoute(donationPromotersListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "donations:read");
  return json(donationPromotersListResponseSchema.parse(await listDonationPromoters(db, data.query)));
});
