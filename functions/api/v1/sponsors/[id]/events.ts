/**
 * GET /api/v1/sponsors/:id/events — paginated pipeline audit trail.
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { listSponsorshipEvents } from "../../../../_lib/services/sponsorship";
import { sponsorshipEventsRouteSchema } from "../../../../../assets/shared/schemas/sponsorship-management";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const SponsorEventsGet = openApiRoute(sponsorshipEventsRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "sponsorships:read");

  return json(await listSponsorshipEvents(db, data.params.id, data.query));
});
