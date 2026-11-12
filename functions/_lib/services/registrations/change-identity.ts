import type { z } from "zod";
import { registrationIdentityChangeSchema } from "../../../../assets/shared/schemas/registration-identity";
import type { UserSessionTokenClaims } from "../../auth/user-session-token";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLogAfterOneChange } from "../audit";
import { ownedIdentityAtEvidence } from "../identities/selection";
import { prepareBadgeRenderJobsForUser } from "../badge-render-job-statements";

export interface RegistrationIdentityChange {
  change: z.infer<typeof registrationIdentityChangeSchema>;
  claims: UserSessionTokenClaims;
}

/** Statements committed only with the registration details and durable notification. */
export function prepareRegistrationIdentityChange(
  db: DatabaseLike,
  registrationId: string,
  { change, claims }: RegistrationIdentityChange,
) {
  const userId = claims.sub;
  const now = nowIso();
  return [
    prepareAuthorizationGuard(db, userSessionRequestAuthorizationEvidence(claims)),
    prepareAuthorizationGuard(db, registrationIdentityChangeEvidence(registrationId, { change, claims })),
    db
      .prepare(`UPDATE registrations SET registration_identity_id=?, updated_at=?
      WHERE id=? AND user_id=? AND registration_identity_id IS ?`)
      .bind(change.identityId, now, registrationId, userId, change.expectedIdentityId),
    prepareAuditLogAfterOneChange(
      db,
      "user",
      userId,
      "registration_identity_changed",
      "registration",
      registrationId,
      { identityId: { from: change.expectedIdentityId, to: change.identityId } },
      now,
    ),
    prepareBadgeRenderJobsForUser(db, userId, now, registrationId),
  ];
}

/** Shared ownership and lifecycle evidence for the write guard and refusal diagnosis. */
export function registrationIdentityChangeEvidence(
  registrationId: string,
  { change, claims }: RegistrationIdentityChange,
) {
  const userId = claims.sub;
  const owned = ownedIdentityAtEvidence({ userId, identityId: change.identityId });
  return {
    sql: `SELECT 1 FROM registrations r JOIN users u ON u.id=r.user_id
        WHERE r.id=? AND r.user_id=? AND r.status!='cancelled' AND u.active=1
          AND u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL AND EXISTS (${owned.sql})`,
    bindings: [registrationId, userId, ...owned.bindings],
  };
}
