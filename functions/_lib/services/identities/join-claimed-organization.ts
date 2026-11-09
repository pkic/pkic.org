import { isAuthorizationGuardFailure, isStateGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure } from "../audit";
import { prepareOwnAffiliationReviewResolution } from "./affiliation-offer";
import { isConcurrentIdentityConflict } from "./conflicts";
import { prepareVerifiedOrganizationAffiliation } from "./reconciliation";

interface VerifiedAddress {
  normalized_email: string;
}

/**
 * Explicit current-user organization join. Merely verifying an event or
 * account email never calls this use case.
 */
export async function createCurrentUserIdentityFromDomain(
  db: DatabaseLike,
  input: { userId: string; sessionId: string; organizationId: string; emailId: string | null; jobTitle: string },
): Promise<{ identityId: string; state: "active" }> {
  const address = input.emailId
    ? await first<VerifiedAddress>(
        db,
        `SELECT normalized_email FROM user_emails
          WHERE id = ? AND user_id = ? AND verified_at IS NOT NULL`,
        [input.emailId, input.userId],
      )
    : await first<VerifiedAddress>(
        db,
        `SELECT normalized_email FROM users
          WHERE id = ? AND active = 1 AND email_verified_at IS NOT NULL`,
        [input.userId],
      );
  if (!address) throw new AppError(422, "IDENTITY_EMAIL_UNVERIFIED", "Select a verified email address");
  const at = nowIso();
  const prepared = await prepareVerifiedOrganizationAffiliation(db, {
    ...input,
    normalizedEmail: address.normalized_email,
    profile: { jobTitle: input.jobTitle },
    at,
    proofEvidence: {
      sql: `SELECT 1 FROM sessions session
              JOIN users person ON person.id = session.user_id AND person.active = 1
             WHERE session.id = ? AND session.user_id = ? AND session.revoked_at IS NULL
               AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      bindings: [input.sessionId, input.userId],
    },
  });
  try {
    await db.batch([
      ...prepared.statements,
      prepareOwnAffiliationReviewResolution(db, { userId: input.userId, identityId: prepared.identityId, at }),
    ]);
  } catch (error) {
    if (isStateGuardFailure(error))
      throw new AppError(
        409,
        "ORGANIZATION_AFFILIATION_CHANGED",
        "The organization changed. Confirm your organization again.",
      );
    if (isConcurrentIdentityConflict(error) || isAuditChangeGuardFailure(error) || isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_CONFLICT", "The identity or domain authorization changed concurrently");
    }
    throw error;
  }
  return { identityId: prepared.identityId, state: "active" };
}
