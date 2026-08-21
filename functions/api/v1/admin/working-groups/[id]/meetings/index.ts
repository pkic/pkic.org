/**
 * GET/POST /api/v1/admin/working-groups/:id/meetings — list/create meeting
 * series for a working group. Access is gated by the parent working-groups/
 * :id/ router's own middleware (see ../router.ts's requireWorkingGroupAccess),
 * not by a per-handler requirePermission call — matches
 * events/[eventSlug]/router.ts's requireEventManagementAccess precedent.
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { listAdminMeetingSeriesForWg, createWgMeetingSeries } from "../../../../../../_lib/services/meeting-calendar";
import {
  wgMeetingsListRouteSchema,
  wgMeetingsCreateRouteSchema,
} from "../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export const WgMeetingsGet = openApiRoute(wgMeetingsListRouteSchema, async (c: AdminContext, data) => {
  const meetingSeries = await listAdminMeetingSeriesForWg(requestDb(c), data.params.id);
  return json({ meetingSeries });
});

export const WgMeetingsCreate = openApiRoute(wgMeetingsCreateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = data.body;
  const meetingSeries = await createWgMeetingSeries(requestDb(c), data.params.id, body, admin.id);
  return json({ meetingSeries }, 201);
});
