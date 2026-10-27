/** One corrective transition, shared by the owner and authorized staff without creating former-role history. */
import type { z } from "zod";
import { identityCorrectionSchema } from "../../../../assets/shared/schemas/identity";
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { readAdminCredential, prepareUserBackedAdminFromRequest } from "../../auth/admin";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { permissionsAuthorizationEvidence } from "../../auth/permissions";
import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareIncorrectRepresentationRemoval, incorrectRepresentationRemovalError } from "./remove-own";

const correctionPermissions = [{ permission: "membership:write" }, { permission: "identities:activate" }] as const;

async function authority(db: DatabaseLike, request: Request, env: Env, userId: string) {
  const credential = await readAdminCredential(request, env);
  if (credential.kind === "api-key")
    throw new AppError(403, "USER_SESSION_REQUIRED", "Sign in to correct a representation.");
  if (credential.kind === "mcp") {
    const read = await prepareUserBackedAdminFromRequest(db, request, env);
    if (!read) throw new AppError(401, "AUTH_REQUIRED", "Sign in to correct a representation.");
    const permission = permissionsAuthorizationEvidence(read.permissionActor, correctionPermissions);
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
    correctionPermissions,
  );
  const evidence: AuthorizationEvidence[] = read.claims.sub === userId ? [live] : [staff, permission];
  return { ...read, actorId: read.claims.sub, evidence };
}

export async function correctRepresentation(
  db: DatabaseLike,
  request: Request,
  env: Env,
  userId: string,
  identityId: string,
  input: z.infer<typeof identityCorrectionSchema>,
) {
  const actor = await authority(db, request, env, userId);
  try {
    const loaded = await db.batch([
      ...actor.statements,
      ...actor.evidence.map((evidence) => prepareAuthorizationGuard(db, evidence)),
      ...prepareIncorrectRepresentationRemoval(db, {
        identityId,
        actorId: actor.actorId,
        ownerId: userId,
        at: nowIso(),
        correction: input,
      }),
    ]);
    await actor.decode(loaded.slice(0, actor.statements.length));
  } catch (cause) {
    incorrectRepresentationRemovalError(cause, true);
  }
  return { success: true as const, identityId: input.replacementIdentityId, state: "active" as const };
}
