/**
 * GET /api/v1/admin/sponsorships/:id/events — full pipeline audit trail.
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

  const events = await listSponsorshipEvents(db, data.params.id);
  return json({
    events: events.map((e) => ({
      id: e.id,
      fromStage: e.from_stage,
      toStage: e.to_stage,
      actorUserId: e.actor_user_id,
      actorName: e.actor_name,
      note: e.note,
      createdAt: e.created_at,
    })),
  });
});
