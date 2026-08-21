/**
 * PATCH /api/v1/admin/sponsorships/tier-config/:id — update a sponsorship
 * tier's price/currency/active state. This is the "no deployment needed
 * for a price change" endpoint (PR #1 review) — updates
 * sponsorship_tier_config directly; the next self-service checkout picks
 * it up immediately.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { updateTierConfig } from "../../../../../_lib/services/sponsorship";
import { sponsorshipTierConfigUpdateRouteSchema } from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const SponsorshipTierConfigUpdate = openApiRoute(
  sponsorshipTierConfigUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "sponsorships:write");

    const body = data.body;
    const { id } = data.params;
    const tier = await updateTierConfig(db, admin.id, id, body);

    return json({ tier });
  },
);
