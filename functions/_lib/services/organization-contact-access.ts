import { guardMemberSessionMutationDatabase } from "../auth/member";
import { hasPermission, guardPermissionMutationDatabase } from "../auth/permissions";
import type { UserSessionResult } from "../auth/user-session-result";
import { guardDatabaseBatches } from "../db/guarded-database";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import {
  prepareOrganizationIdentityManagementGuard,
  requireOrganizationIdentityManagement,
} from "./identities/authorization";

/** Both callers use the same resource; reads and writes recheck live authority inside each D1 batch. */
export async function organizationContactAccess(
  db: DatabaseLike,
  session: UserSessionResult,
  organizationId: string,
  permission: "organizations:read" | "organizations:write",
) {
  if (session.staff && hasPermission(session.staff, permission)) {
    return {
      db: guardPermissionMutationDatabase(
        db,
        session.staff,
        [{ permission }],
        () =>
          new AppError(
            409,
            "ORGANIZATION_AUTHORIZATION_CHANGED",
            "Organization permission changed; reload before retrying",
          ),
      ),
      actor: { userId: session.identity.id, actorType: "admin" as const },
    };
  }
  const member = session.member;
  if (!member) throw new AppError(403, "ORGANIZATION_CONTACT_REQUIRED", "Organization contact access is required");
  if (member.organizationId !== organizationId) {
    throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found for the acting identity");
  }
  const evidence = {
    memberId: member.memberId,
    organizationId,
    actorUserId: member.userId,
    sessionId: member.sessionId,
    staffAuthorized: false,
  };
  await requireOrganizationIdentityManagement(db, evidence);
  const sessionDb = guardMemberSessionMutationDatabase(db, member);
  return {
    db: guardDatabaseBatches(sessionDb, async (statements) => {
      try {
        const [, ...results] = await sessionDb.batch([
          prepareOrganizationIdentityManagementGuard(sessionDb, evidence),
          ...statements,
        ]);
        return results;
      } catch (error) {
        if (isAuthorizationGuardFailure(error)) {
          throw new AppError(
            409,
            "ORGANIZATION_AUTHORIZATION_CHANGED",
            "Organization contact access changed; reload before retrying",
          );
        }
        throw error;
      }
    }),
    actor: { userId: member.userId, actorType: "member" as const },
  };
}
