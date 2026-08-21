/**
 * GET /api/v1/admin/sponsorships/:id/events — paginated pipeline audit trail.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { listSponsorshipEvents } from "../../../../../_lib/services/sponsorship";
import { sponsorshipEventsRouteSchema } from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const SponsorshipEventsList = openApiRoute(sponsorshipEventsRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:read");

  return json(await listSponsorshipEvents(db, data.params.id, data.query));
});
