import {
  badgeIssueRouteSchema,
  badgeRevokeRouteSchema,
  badgeAttendeesRouteSchema,
  badgeCredentialsRouteSchema,
  badgeCredentialRouteSchema,
  badgePrintRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-badges";
import { guardPermissionDatabase } from "../../../../_lib/auth/permissions";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { issueBadge, revokeBadge } from "../../../../_lib/services/event-participation/badge-lifecycle";
import {
  listBadgeCredentials,
  getBadgeCredential,
} from "../../../../_lib/services/event-participation/badge-credentials";
import { prepareBadgePrint } from "../../../../_lib/services/event-participation/badge-print";
import { requireEventPermission } from "./authorization";
import { badgeAttendees } from "../../../../_lib/services/event-participation/badge-attendees";
export const EventBadgeAttendeesGet = openApiRoute(badgeAttendeesRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await badgeManagementContext(c, data.params.eventSlug);
  return json(await badgeAttendees(db, event.id, data.query));
});
export const EventBadgesGet = openApiRoute(badgeCredentialsRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await badgeManagementContext(c, data.params.eventSlug);
  return json(await listBadgeCredentials(db, event.id, data.query));
});
export const EventBadgeGet = openApiRoute(badgeCredentialRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await badgeManagementContext(c, data.params.eventSlug);
  return json(await getBadgeCredential(db, event.id, data.params.badgeId));
});
export const EventBadgeCreate = openApiRoute(badgeIssueRouteSchema, async (c: AdminContext, data) => {
  const { db, event, actor } = await badgeManagementContext(c, data.params.eventSlug);
  return json(await issueBadge(db, event.id, actor.id, data.body, c.env));
});
export const EventBadgeDelete = openApiRoute(badgeRevokeRouteSchema, async (c: AdminContext, data) => {
  const { db, event, actor } = await badgeManagementContext(c, data.params.eventSlug);
  await revokeBadge(db, event.id, actor.id, data.params.badgeId);
  return json({ success: true });
});
export const EventBadgePrint = openApiRoute(badgePrintRouteSchema, async (c: AdminContext, data) => {
  const { db, event, actor } = await badgeManagementContext(c, data.params.eventSlug);
  return json(await prepareBadgePrint(db, c.env, event.id, data.params.badgeId, actor.id, data.body));
});
async function badgeManagementContext(c: AdminContext, slug: string) {
  markResponseSensitive(c);
  const { db, event, actor, context } = await requireEventPermission(c, slug, "events:manage");
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission: "events:manage", context }],
    () => new AppError(403, "BADGE_PERMISSION_CHANGED", "Your badge management permission changed."),
  );
  return { db: guarded, event, actor };
}
