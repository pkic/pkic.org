import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { readAdminCredential, prepareUserBackedAdminFromRequest } from "../../auth/admin";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { permissionsAuthorizationEvidence } from "../../auth/permissions";
import { type AuthorizationEvidence } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
export async function prepareRepresentationAuthority(
  db: DatabaseLike,
  request: Request,
  env: Env,
  userId: string,
  required: readonly { permission: Permission }[],
) {
  const credential = await readAdminCredential(request, env);
  if (credential.kind === "api-key")
    throw new AppError(403, "USER_SESSION_REQUIRED", "Sign in to manage a representation.");
  if (credential.kind === "mcp") {
    const read = await prepareUserBackedAdminFromRequest(db, request, env);
    if (!read) throw new AppError(401, "AUTH_REQUIRED", "Sign in to manage a representation.");
    const permission = permissionsAuthorizationEvidence(read.permissionActor, required);
    return {
      ...read,
      actorId: read.subjectId,
      evidence: [read.authorizationEvidence, permission],
    };
  }
  const read = await prepareUserSessionRequest(db, request, env);
  const live = userSessionRequestAuthorizationEvidence(read.claims);
  const staff = userSessionRequestAuthorizationEvidence(read.claims, true);
  const permission = permissionsAuthorizationEvidence(
    createUserBackedAuthAdmin({
      id: read.claims.sub,
      email: "",
      scopes: [],
      sessionId: read.claims.sid,
    }),
    required,
  );
  const evidence: AuthorizationEvidence[] = read.claims.sub === userId ? [live] : [staff, permission];
  return { ...read, actorId: read.claims.sub, evidence };
}
