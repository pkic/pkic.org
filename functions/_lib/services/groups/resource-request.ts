/** Prepared group/session context for resource requests, decoded before exposing protected results. */
import { requireAuthenticatedGroupContext } from "./detail";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { readAdminCredential, prepareUserBackedAdminFromRequest } from "../../auth/admin";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { userSessionActingIdentitySelection, userSessionMemberSelection } from "../../auth/identity-capacities";
import { permissionsAuthorizationEvidence } from "../../auth/permissions";
import { sessionHoldsCapacity } from "../../auth/user-session-result";
import { AppError } from "../../errors";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import { prepareAuthenticatedGroupContext } from "./read-model";
import { activeGroupMembershipAuthorizationEvidence } from "./access";
import { groupManagementCandidateAuthorizationEvidence } from "./governance";

export async function prepareGroupResourceRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  reference: string,
) {
  const delegated = (await readAdminCredential(request, env)).kind === "mcp";
  const human = delegated ? null : await prepareUserSessionRequest(db, request, env);
  const machine = delegated ? await prepareUserBackedAdminFromRequest(db, request, env) : null;
  if (!human && !machine) throw new AppError(401, "AUTH_REQUIRED", "An authenticated portal identity is required");
  const userId = human?.claims.sub ?? machine!.subjectId;
  const admin =
    machine?.permissionActor ?? createUserBackedAuthAdmin({ id: userId, email: "", sessionId: human!.claims.sid });
  const memberSelection =
    machine?.memberSelection ?? (human ? userSessionMemberSelection(userId, human.claims.iid) : undefined);
  const identitySelection =
    machine?.actingIdentitySelection ?? (human ? userSessionActingIdentitySelection(userId, human.claims.iid) : null);
  const authStatements = human?.statements ?? machine!.statements;
  const group = {
    sql: "SELECT id FROM groups WHERE id=? OR slug=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1",
    bindings: [reference, reference, reference],
  };
  const groupRead = prepareAuthenticatedGroupContext(
    db,
    group,
    { userId, admin },
    permissionsAuthorizationEvidence(admin, [{ permission: "groups:read" }]),
    memberSelection,
  );
  const sessionEvidence = human ? userSessionRequestAuthorizationEvidence(human.claims) : null;
  const manage = groupManagementCandidateAuthorizationEvidence(admin, "g.id", memberSelection);
  return {
    userId,
    group,
    identitySelection,
    participationEvidence:
      sessionEvidence && memberSelection
        ? {
            sql: `WITH submission_session AS MATERIALIZED (${sessionEvidence.sql}),
          submission_member(member_id) AS MATERIALIZED (${memberSelection.sql})
          SELECT 1 FROM submission_session WHERE (SELECT member_id FROM submission_member) IS NOT NULL`,
            bindings: [...sessionEvidence.bindings, ...memberSelection.bindings],
          }
        : { sql: "SELECT 1 WHERE 0", bindings: [] },
    access: {
      memberEvidence: activeGroupMembershipAuthorizationEvidence(userId, group),
      managerEvidence: {
        sql: `SELECT 1 FROM groups g WHERE g.id=(${group.sql}) AND EXISTS(${manage.sql})`,
        bindings: [...group.bindings, ...manage.bindings],
      },
    },
    statements: [...authStatements, groupRead.statement],
    async decode(results: D1StatementResult[]) {
      const staff = machine ? await machine.decode(results.slice(0, authStatements.length)) : undefined;
      const session = human ? await human.decode(results.slice(0, authStatements.length)) : null;
      if (session && !sessionHoldsCapacity(session))
        throw new AppError(401, "AUTH_REQUIRED", "An authenticated portal identity is required");
      if (staff && !staff.scopes?.some((scope) => scope === "groups:read" || scope === "groups:write"))
        throw new AppError(401, "AUTH_REQUIRED", "An authenticated portal identity is required");
      const context = requireAuthenticatedGroupContext(groupRead.decode(results[authStatements.length]), {
        userId,
        admin: staff ?? session?.staff,
      });
      return { ...context, member: session?.member, staff: staff ?? session?.staff };
    },
  };
}
