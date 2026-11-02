import type { z } from "zod";
import {
  registrationIdentityChangeSchema,
  registrationIdentityChangeResponseSchema,
} from "../../../../assets/shared/schemas/registration-identity";
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLogAfterOneChange, isAuditChangeGuardFailure } from "../audit";
import { ownedIdentityAtEvidence } from "../identities/selection";
import { prepareBadgeRenderJobsForUser } from "../badge-render-job-statements";

/** One atomic command: live session, ownership, identity choice, audit, and badge invalidation. */
export async function changeRegistrationIdentity(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  registrationId: string,
  change: z.infer<typeof registrationIdentityChangeSchema>,
) {
  const session = await prepareUserSessionRequest(db, request, env);
  const userId = session.claims.sub;
  const now = nowIso();
  const owned = ownedIdentityAtEvidence({ userId, identityId: change.identityId, at: now });
  try {
    const results = await db.batch([
      prepareAuthorizationGuard(db, userSessionRequestAuthorizationEvidence(session.claims)),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM registrations r JOIN users u ON u.id=r.user_id
          WHERE r.id=? AND r.user_id=? AND r.status!='cancelled' AND u.active=1
            AND u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL AND EXISTS (${owned.sql})`,
        bindings: [registrationId, userId, ...owned.bindings],
      }),
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
      db
        .prepare(`SELECT identity.id, identity.organization_id AS organizationId,
        organization.name AS organizationName, identity.job_title AS jobTitle
        FROM identities identity LEFT JOIN organizations organization ON organization.id=identity.organization_id
        WHERE identity.id=? AND identity.user_id=?`)
        .bind(change.identityId, userId),
    ]);
    return registrationIdentityChangeResponseSchema.parse({
      success: true,
      identity: batchFirst(results.at(-1)!),
      badgeVersion: now,
    });
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        403,
        "REGISTRATION_IDENTITY_UNAVAILABLE",
        "Choose an active identity on your own registration.",
      );
    if (isAuditChangeGuardFailure(error))
      throw new AppError(
        409,
        "REGISTRATION_CHANGED",
        "Your registration changed. Reload it before choosing an identity.",
      );
    throw error;
  }
}
