/**
 * PATCH /api/v1/admin/sponsorships/tier-config/:id — update a sponsorship
 * tier's price/currency/active state. This is the "no deployment needed
 * for a price change" endpoint (PR #1 review) — updates
 * sponsorship_tier_config directly; the next self-service checkout picks
 * it up immediately.
 */
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { updateTierConfig } from "../../../../../_lib/services/sponsorship";
import {
  sponsorshipTierConfigUpdateSchema,
  sponsorshipTierConfigUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:write");

  const body = await parseJsonBody(c.req, sponsorshipTierConfigUpdateSchema);
  const id = c.req.param("id");
  const tier = await updateTierConfig(db, id, body);

  await writeAuditLog(db, "admin", admin.id, "sponsorship_tier_config_updated", "sponsorship_tier_config", id, body);

  return json({ tier });
}

export const SponsorshipTierConfigUpdate = openApiRoute(sponsorshipTierConfigUpdateRouteSchema, onRequestPatch);
