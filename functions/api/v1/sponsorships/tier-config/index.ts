/**
 * GET /api/v1/sponsorships/tier-config — sponsorship tier pricing
 * config (self-service checkout). Managed data (consolidated migration
 * 0035), not a code constant — see [id].ts for the PATCH that updates it.
 */
import { json } from "../../../../_lib/http";
import { listTierConfig } from "../../../../_lib/services/sponsorship";
import { sponsorshipTierConfigListRouteSchema } from "../../../../../assets/shared/schemas/sponsorship-management";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const { db } = await requireStaffPermission(c, "sponsorships:read");

  const tiers = await listTierConfig(db);
  return json({ tiers });
}

export const SponsorshipTierConfigList = openApiRoute(sponsorshipTierConfigListRouteSchema, onRequestGet);
