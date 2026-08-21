/**
 * GET /api/v1/admin/sponsorships/tier-config — sponsorship tier pricing
 * config (self-service checkout). Managed data (consolidated migration
 * 0035), not a code constant — see [id].ts for the PATCH that updates it.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { listTierConfig } from "../../../../../_lib/services/sponsorship";
import { sponsorshipTierConfigListRouteSchema } from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:read");

  const tiers = await listTierConfig(db);
  return json({ tiers });
}

export const SponsorshipTierConfigList = openApiRoute(sponsorshipTierConfigListRouteSchema, onRequestGet);
