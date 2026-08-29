import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requireUserBackedAuthAdmin } from "../../../../_lib/auth/admin-identity";
import { guardPermissionDatabase, requirePermission } from "../../../../_lib/auth/permissions";
import { AppError } from "../../../../_lib/errors";
import { importEvent } from "../../../../_lib/services/events";
import { getEventDetail } from "../../../../_lib/services/events/detail";
import { eventImportResponseSchema } from "../../../../../assets/shared/schemas/event-imports";
import { eventImportCreateRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-events";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

/**
 * Import an event definition from an external generator.
 *
 * Unlike the retired admin sync route, this requires an attributable user
 * session: the shared API key cannot import events, and the caller's
 * `events:write` grant is re-evaluated inside the same D1 batch as the event,
 * terms, and audit writes.
 */
export const EventImportsCreate = openApiRoute(eventImportCreateRouteSchema, async (c: AdminContext, data) => {
  // Imports are staff-only, but /api/v1/events/ is not a middleware-covered
  // staff prefix, so mark the response private explicitly.
  markResponseSensitive(c);
  const db = requestDb(c);
  const actor = requireUserBackedAuthAdmin(await requireAdminFromRequest(db, c.req.raw, c.env));
  requirePermission(actor, "events:write");

  const { source, event, terms } = data.body;
  const settings = {
    ...(event.settings ?? {}),
    ...(event.frontend ? { frontend: event.frontend } : {}),
  };

  const guardedDb = guardPermissionDatabase(
    db,
    actor,
    [{ permission: "events:write" }],
    () => new AppError(409, "EVENT_IMPORT_AUTHORIZATION_CHANGED", "Event write permission changed during this import"),
  );
  const result = await importEvent(guardedDb, source, { ...event, settings }, terms, actor.id);

  return json(
    eventImportResponseSchema.parse({
      success: true,
      source,
      created: result.created,
      event: await getEventDetail(db, result.event.slug, ["read", "write"]),
    }),
  );
});
