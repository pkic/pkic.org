/** Remove an incorrect affiliation rather than listing it as former experience. */
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLogAfterOneChange } from "../audit";
import { prepareOrganizationIdentityPublication } from "./lifecycle-publication";

export async function removeOwnRepresentation(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  identityId: string,
) {
  const actor = await prepareUserSessionRequest(db, request, env);
  const at = nowIso();
  try {
    const results = await db.batch([
      ...actor.statements,
      prepareAuthorizationGuard(db, userSessionRequestAuthorizationEvidence(actor.claims)),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM identities WHERE id=? AND user_id=? AND organization_id IS NOT NULL AND blocked_at IS NULL",
        bindings: [identityId, actor.claims.sub],
      }),
      prepareOrganizationIdentityPublication(db, identityId, at),
      db
        .prepare("DELETE FROM organization_link_notices WHERE identity_id=? AND user_id=?")
        .bind(identityId, actor.claims.sub),
      db
        .prepare("DELETE FROM affiliation_reviews WHERE resolved_identity_id=? AND user_id=?")
        .bind(identityId, actor.claims.sub),
      db.prepare("DELETE FROM user_roles WHERE identity_id=? AND user_id=?").bind(identityId, actor.claims.sub),
      db.prepare("DELETE FROM group_memberships WHERE identity_id=? AND user_id=?").bind(identityId, actor.claims.sub),
      // Registration and address references detach through their existing FK actions.
      // Votes, accepted speaker records and successors deliberately restrict deletion.
      db
        .prepare(
          "DELETE FROM identities WHERE id=? AND user_id=? AND organization_id IS NOT NULL AND blocked_at IS NULL",
        )
        .bind(identityId, actor.claims.sub),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        actor.claims.sub,
        "incorrect_representation_removed",
        "identity",
        identityId,
        {},
        at,
      ),
    ]);
    await actor.decode(results.slice(0, actor.statements.length));
  } catch (cause) {
    if (isAuthorizationGuardFailure(cause))
      throw new AppError(
        409,
        "IDENTITY_REMOVAL_NOT_ALLOWED",
        "This representation cannot be removed. Refresh your profile and try again.",
      );
    if (cause instanceof Error && /FOREIGN KEY constraint failed|SQLITE_CONSTRAINT_FOREIGNKEY/u.test(cause.message))
      throw new AppError(
        409,
        "IDENTITY_HAS_PARTICIPATION",
        "This representation has participation records. Correct those records first, or end the representation.",
      );
    throw cause;
  }
  return { success: true as const };
}
