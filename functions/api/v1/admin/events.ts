import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { requirePermission } from "../../../_lib/auth/permissions";
import { openApiRoute } from "../../../_lib/openapi/route";
import { createAdminEvent } from "../../../_lib/services/events";
import { getAdminEventDetail } from "../../../_lib/services/events/admin-detail";
import { initialEventSettings } from "../../../_lib/services/events/settings";
import { listAdminEvents } from "../../../_lib/services/events/admin-list";
import {
  adminEventCreateResponseSchema,
  adminEventsListQuerySchema,
  adminEventsListResponseSchema,
} from "../../../../assets/shared/schemas/admin-events";
import { adminEventCreateRouteSchema } from "../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

/**
 * GET /api/v1/admin/events
 *
 * Returns a bounded, paginated page of events with aggregate registration
 * and invite counts. Supports both session-token auth and ADMIN_API_KEY.
 */
export const AdminEventsListGet = openApiRoute(
  {
    tags: ["Admin events"],
    summary: "List events (admin)",
    description: "Paginated, optionally sorted list of every event, with aggregate registration and invite counts.",
    request: { query: adminEventsListQuerySchema },
    responses: {
      "200": {
        description: "Events list.",
        content: { "application/json": { schema: adminEventsListResponseSchema } },
      },
    },
  },
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "events:read");

    return json(await listAdminEvents(requestDb(c), data.query));
  },
);

/**
 * POST /api/v1/admin/events
 *
 * Creates a new event from the admin console. The slug must be unique.
 */
export const AdminEventsCreatePost = openApiRoute(adminEventCreateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "events:write");
  const body = data.body;

  await createAdminEvent(
    requestDb(c),
    {
      slug: body.slug,
      name: body.name,
      timezone: body.timezone,
      startsAt: body.startsAt ?? undefined,
      endsAt: body.endsAt ?? undefined,
      registrationMode: body.registrationMode,
      inviteLimitAttendee: body.inviteLimitAttendee,
      settings: initialEventSettings(body),
    },
    admin.id,
  );

  return json(adminEventCreateResponseSchema.parse({ event: await getAdminEventDetail(requestDb(c), body.slug) }), 201);
});
