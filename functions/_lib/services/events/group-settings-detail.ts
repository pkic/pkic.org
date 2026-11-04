import type { PreparedUserSessionRead } from "../../auth/user-session-request";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { userSessionMemberSelection } from "../../auth/identity-capacities";
import { permissionsAuthorizationEvidence } from "../../auth/permissions";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, D1StatementResult } from "../../types";
import { prepareAuthenticatedGroupContext } from "../groups/read-model";
import { groupResourceContextAuthorizationEvidence } from "../resource-grants/access";
import { prepareEventDetail, decodeEventDetail, type EventDetailRow } from "./detail";

/** One canonical selected-group configuration check for reads and image saves. */
export function prepareGroupEventSettingsAccess(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  slug: string,
  memberSelection?: AuthorizationEvidence,
) {
  const groupRead = prepareAuthenticatedGroupContext(
    db,
    groupId,
    { userId: actor.id, admin: actor },
    permissionsAuthorizationEvidence(actor, [{ permission: "groups:read" }]),
    memberSelection,
  );
  const access = groupResourceContextAuthorizationEvidence(
    { sql: "SELECT id FROM groups WHERE id = ? OR slug = ?", bindings: [groupId, groupId] },
    "event",
    { sql: "SELECT id FROM events WHERE slug = ?", bindings: [slug] },
    "manage",
  );
  return {
    statements: [groupRead.statement, db.prepare(`SELECT EXISTS(${access.sql}) AS allowed`).bind(...access.bindings)],
    decode(results: D1StatementResult[]) {
      const group = groupRead.decode(results[0]);
      if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
      if (!group.manager)
        throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
      if (batchFirst<{ allowed: number }>(results[1])?.allowed !== 1)
        throw new AppError(403, "RESOURCE_CAPABILITY_REQUIRED", "Resource capability is required");
      return group.group.id;
    },
  };
}

/** Configuration and its exact selected-group authority share one authenticated read snapshot. */
export async function readGroupEventSettingsPage(
  db: DatabaseLike,
  auth: PreparedUserSessionRead | null,
  groupId: string,
  slug: string,
) {
  if (!auth) throw new AppError(401, "AUTH_REQUIRED", "Sign in to view event settings");
  const candidate = createUserBackedAuthAdmin({ id: auth.claims.sub, email: "", sessionId: auth.claims.sid });
  const access = prepareGroupEventSettingsAccess(
    db,
    candidate,
    groupId,
    slug,
    userSessionMemberSelection(auth.claims.sub, auth.claims.iid),
  );
  const results = await db.batch([...auth.statements, ...access.statements, prepareEventDetail(db, slug)]);
  const session = await auth.decode(results.slice(0, auth.statements.length));
  if (!session.staff) throw new AppError(403, "PERMISSION_REQUIRED", "Event management permission is required");
  access.decode(results.slice(auth.statements.length));
  const event = batchFirst<EventDetailRow>(results.at(-1)!);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  return decodeEventDetail(event, ["read"]);
}
