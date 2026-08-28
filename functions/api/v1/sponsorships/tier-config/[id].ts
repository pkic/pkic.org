/**
 * PATCH /api/v1/sponsorships/tier-config/:id — update a sponsorship
 * tier's price/currency/active state. This is the "no deployment needed
 * for a price change" endpoint (PR #1 review) — updates
 * sponsorship_tier_config directly; the next self-service checkout picks
 * it up immediately.
 */
import { json } from "../../../../_lib/http";
import { authorizedSponsorshipMutationDb, updateTierConfig } from "../../../../_lib/services/sponsorship";
import { sponsorshipTierConfigUpdateRouteSchema } from "../../../../../assets/shared/schemas/sponsorship-management";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const SponsorshipTierConfigUpdate = openApiRoute(
  sponsorshipTierConfigUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "sponsorships:write");

    const body = data.body;
    const { id } = data.params;
    const tier = await updateTierConfig(authorizedSponsorshipMutationDb(db, staff), staff.id, id, body);

    return json({ tier });
  },
);
