import {
  badgeIssueRouteSchema,
  badgeRevokeRouteSchema,
  badgeAttendeesRouteSchema,
  badgeCredentialsRouteSchema,
  badgeCredentialRouteSchema,
  badgePrintRouteSchema,
  badgePrintingRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-badges";
import { currentBadgeRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-event-current-badge";
import { guardPermissionDatabase } from "../../../../_lib/auth/permissions";
import { requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { issueBadge, revokeBadge } from "../../../../_lib/services/event-participation/badge-lifecycle";
import {
  listBadgeCredentials,
  getBadgeCredential,
} from "../../../../_lib/services/event-participation/badge-credentials";
import { getBadgePrintingContext } from "../../../../_lib/services/event-participation/badge-print-branding";
import { prepareBadgePrint } from "../../../../_lib/services/event-participation/badge-print";
import { requireEventPermission } from "./authorization";
import { badgeAttendees } from "../../../../_lib/services/event-participation/badge-attendees";
import { prepareBadgeHolderTicket } from "../../../../_lib/services/event-participation/badge-holder-ticket";
import { getEventBySlug } from "../../../../_lib/services/events";
/** The signed-in holder's own badge only; no identifier selects another attendee's credential. */
export const EventBadgeCurrentPut = openApiRoute(currentBadgeRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const holder = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(
    await prepareBadgeHolderTicket(db, c.env, event.id, { userId: holder.userId, sessionId: holder.sessionId }),
  );
});
export const EventBadgeAttendeesGet = openApiRoute(badgeAttendeesRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await badgeManagementContext(c, data.params.eventSlug);
  return json(await badgeAttendees(db, event.id, data.query));
});
export const EventBadgePrintingGet = openApiRoute(badgePrintingRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await badgeManagementContext(c, data.params.eventSlug);
  return json(await getBadgePrintingContext(db, c.env, event.id));
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
