import { parseJsonBody } from "../../../_lib/validation";
import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { requirePermission } from "../../../_lib/auth/permissions";
import { openApiRoute } from "../../../_lib/openapi/route";
import { eventSlugExists, upsertEventFromHugo } from "../../../_lib/services/events";
import { listAdminEvents } from "../../../_lib/services/events/admin-list";
import { writeAuditLog } from "../../../_lib/services/audit";
import { parseJsonSafe } from "../../../_lib/utils/json";
import {
  adminCreateEventSchema,
  adminEventsListQuerySchema,
  adminEventsListResponseSchema,
} from "../../../../assets/shared/schemas/api";
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

    return json(
      await listAdminEvents(requestDb(c), {
        ...data.query,
        limit: data.query.limit ?? 50,
        offset: data.query.offset ?? 0,
      }),
    );
  },
);

/**
 * POST /api/v1/admin/events
 *
 * Creates a new event from the admin console. The slug must be unique.
 */
export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "events:write");
  const body = await parseJsonBody(c.req, adminCreateEventSchema);

  // Check slug uniqueness before upsert to give a clear error
  if (await eventSlugExists(requestDb(c), body.slug)) {
    return json({ error: { code: "SLUG_TAKEN", message: `The slug '${body.slug}' is already in use` } }, 409);
  }

  const settings: Record<string, unknown> = {};
  if (body.venue) settings["venue"] = body.venue;
  if (body.virtualUrl) settings["virtualUrl"] = body.virtualUrl;

  const event = await upsertEventFromHugo(requestDb(c), {
    slug: body.slug,
    name: body.name,
    timezone: body.timezone,
    startsAt: body.startsAt ?? undefined,
    endsAt: body.endsAt ?? undefined,
    registrationMode: body.registrationMode,
    inviteLimitAttendee: body.inviteLimitAttendee,
    settings,
  });

  await writeAuditLog(requestDb(c), "admin", admin.id, "event_created", "event", event.id, { slug: event.slug });

  return json(
    {
      event: {
        ...event,
        settings: parseJsonSafe<Record<string, unknown>>(event.settings_json, {}),
      },
    },
    201,
  );
}
