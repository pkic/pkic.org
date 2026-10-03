import {
  badgeIssueRouteSchema,
  badgeRevokeRouteSchema,
  badgeAttendeesRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-badges";
import { guardPermissionDatabase } from "../../../../_lib/auth/permissions";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { issueBadge, revokeBadge } from "../../../../_lib/services/event-participation/scanning";
import { requireEventPermission } from "./authorization";
import { badgeAttendees } from "../../../../_lib/services/event-participation/badge-attendees";
export const EventBadgeAttendeesGet = openApiRoute(badgeAttendeesRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
  return json(await badgeAttendees(db, event.id, data.query));
});
export const EventBadgeCreate = openApiRoute(badgeIssueRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor, context } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission: "events:manage", context }],
    () => new AppError(403, "BADGE_PERMISSION_CHANGED", "Your badge issuing permission changed."),
  );
  return json(await issueBadge(guarded, event.id, data.body.userId));
});
export const EventBadgeDelete = openApiRoute(badgeRevokeRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor, context } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission: "events:manage", context }],
    () => new AppError(403, "BADGE_PERMISSION_CHANGED", "Your badge management permission changed."),
  );
  await revokeBadge(guarded, event.id, data.params.badgeId);
  return json({ success: true });
});
