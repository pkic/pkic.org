import type { GroupEventSettingsUpdateInput } from "../../../../assets/shared/schemas/group-events";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { userSessionMemberSelection } from "../../auth/identity-capacities";
import { permissionsAuthorizationEvidence } from "../../auth/permissions";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { sessionHoldsCapacity } from "../../auth/user-session-result";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { prepareAuthenticatedGroupContext } from "../groups/read-model";
import { groupResourceContextAuthorizationEvidence } from "../resource-grants/access";
import { commitGroupEventSettings, prepareGroupEventSettingsRead } from "./group-management";
import { prepareGroupEventRead } from "./group-read-model";

/** Resolve the live portal capacity, group, event, and form plan in one preflight snapshot. */
export async function updateGroupEventSettingsFromRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  groupIdOrSlug: string,
  eventId: string,
  input: GroupEventSettingsUpdateInput,
  appBaseUrl: string,
) {
  const auth = await prepareUserSessionRequest(db, request, env);
  const candidate = createUserBackedAuthAdmin({
    id: auth.claims.sub,
    email: "",
    scopes: [],
    sessionId: auth.claims.sid,
  });
  const groupRead = prepareAuthenticatedGroupContext(
    db,
    groupIdOrSlug,
    { userId: auth.claims.sub, admin: candidate },
    permissionsAuthorizationEvidence(candidate, [{ permission: "groups:read" }]),
    userSessionMemberSelection(auth.claims.sub, auth.claims.iid),
  );
  const access = groupResourceContextAuthorizationEvidence(
    { sql: "SELECT id FROM groups WHERE id = ? OR slug = ?", bindings: [groupIdOrSlug, groupIdOrSlug] },
    "event",
    eventId,
    "manage",
  );
  const settingsRead = prepareGroupEventSettingsRead(db, eventId, input);
  const results = await db.batch([
    ...auth.statements,
    groupRead.statement,
    db.prepare(`SELECT EXISTS(${access.sql}) AS allowed`).bind(...access.bindings),
    ...settingsRead.statements,
  ]);
  const session = await auth.decode(results.slice(0, auth.statements.length));
  if (!sessionHoldsCapacity(session))
    throw new AppError(401, "AUTH_REQUIRED", "An authenticated portal identity is required");
  const group = groupRead.decode(results[auth.statements.length]);
  if (!group || (!group.visible && !group.manager)) {
    throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");
  }
  if (!session.staff || !group.manager) {
    throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
  }
  const settingsResults = results.slice(auth.statements.length + 2);
  settingsRead.decodeEvent(settingsResults[0]);
  if (batchFirst<{ allowed: number }>(results[auth.statements.length + 1])?.allowed !== 1) {
    throw new AppError(403, "RESOURCE_CAPABILITY_REQUIRED", "Resource capability is required");
  }
  const snapshot = settingsRead.decode(settingsResults);
  const response = prepareGroupEventRead(
    db,
    {
      userId: session.identity.id,
      admin: session.staff,
      ...(session.member ? { identityId: session.member.identityId } : {}),
    },
    group.group.id,
    eventId,
  );
  const saved = await commitGroupEventSettings(
    db,
    session.staff,
    { groupId: group.group.id, eventId },
    input,
    appBaseUrl,
    snapshot,
    [prepareAuthorizationGuard(db, userSessionRequestAuthorizationEvidence(auth.claims, true))],
    response.statements,
  );
  return response.decode(saved.slice(-response.statements.length));
}
