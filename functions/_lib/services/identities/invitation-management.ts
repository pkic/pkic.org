import { prepareCancelIdentityInvitationEmails } from "./notifications";
import type { z } from "zod";
import type { identityInvitationManagementSchema } from "../../../../assets/shared/schemas/identity-invitation-management";
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { permissionsAuthorizationEvidence } from "../../auth/permissions";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import type { DatabaseLike, Env } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { prepareAuditLogAfterOneChange } from "../audit";
import { organizationIdentityManagementEvidence } from "./authorization";
import { prepareIncorrectRepresentationRemoval, incorrectRepresentationRemovalError } from "./representation-removal";
import { preparePendingIdentityActivation } from "./pending-activation";

/** A pending invitation has no experience to end; activate it explicitly or remove it. */
export async function manageIdentityInvitation(
  db: DatabaseLike,
  request: Request,
  env: Env,
  organizationId: string,
  identityId: string,
  input: z.infer<typeof identityInvitationManagementSchema>,
) {
  const actor = await prepareUserSessionRequest(db, request, env);
  const staff = permissionsAuthorizationEvidence(
    createUserBackedAuthAdmin({
      id: actor.claims.sub,
      email: "",
      scopes: [],
      sessionId: actor.claims.sid,
    }),
    [
      { permission: "membership:write" },
      ...(input.action === "activate" ? [{ permission: "identities:activate" as const }] : []),
    ],
  );
  const contact = organizationIdentityManagementEvidence({
    organizationId,
    memberId: null,
    actorUserId: actor.claims.sub,
    staffAuthorized: false,
  });
  const at = nowIso();
  try {
    const results = await db.batch([
      ...actor.statements,
      prepareAuthorizationGuard(db, userSessionRequestAuthorizationEvidence(actor.claims)),
      prepareAuthorizationGuard(
        db,
        input.action === "activate"
          ? staff
          : {
              sql: `SELECT 1 WHERE EXISTS(${staff.sql}) OR EXISTS(${contact.sql})`,
              bindings: [...staff.bindings, ...contact.bindings],
            },
      ),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM identities identity JOIN users person ON person.id=identity.user_id
          WHERE identity.id=? AND identity.organization_id=? AND identity.user_id=?
            AND identity.started_at IS NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
            AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`,
        bindings: [identityId, organizationId, input.userId],
      }),
      ...(input.action === "cancel"
        ? prepareIncorrectRepresentationRemoval(db, {
            identityId,
            actorId: actor.claims.sub,
            ownerId: input.userId,
            at,
          })
        : preparePendingIdentityActivation(db, {
            identityId,
            userId: input.userId,
            at,
            audit: [
              prepareAuditLogAfterOneChange(
                db,
                "user",
                actor.claims.sub,
                "organization_identity_activated",
                "identity",
                identityId,
                { organizationId, reason: input.reason },
                at,
                { type: "user", id: input.userId },
              ),
            ],
          })),
      ...(input.action === "cancel" ? [prepareCancelIdentityInvitationEmails(db, identityId, at)] : []),
    ]);
    await actor.decode(results.slice(0, actor.statements.length));
  } catch (cause) {
    if (isAuthorizationGuardFailure(cause))
      throw new AppError(
        409,
        "IDENTITY_INVITATION_UNAVAILABLE",
        "The invitation or your permissions changed. Refresh and try again.",
      );
    incorrectRepresentationRemovalError(cause);
  }
  return { success: true as const };
}
