/** Explicit staff activation for a matching approved work domain without claiming mailbox proof. */
import type { AffiliationReviewApprove } from "../../../../assets/shared/schemas/affiliation-reviews";
import { hostWithinDomainSql } from "../../email-domains/sql";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { createOrganizationIdentity } from "./associate";
import type { IdentityManagerActor } from "./types";

function overrideEvidence(userId: string, groupKey: string): AuthorizationEvidence {
  return {
    sql: `SELECT claim.organization_id, person.normalized_email FROM users person
      JOIN organization_domain_claims claim ON claim.application_id IS NULL
        AND ${hostWithinDomainSql("substr(person.normalized_email, instr(person.normalized_email, '@') + 1)", "claim.domain")}
      JOIN organizations organization ON organization.id = claim.organization_id
      WHERE person.id = ? AND person.active = 1 AND person.email_verified_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM organization_domain_claims closer
          WHERE length(closer.domain) > length(claim.domain)
            AND ${hostWithinDomainSql("substr(person.normalized_email, instr(person.normalized_email, '@') + 1)", "closer.domain")})
        AND NOT EXISTS (SELECT 1 FROM identities identity WHERE identity.user_id = person.id AND identity.organization_id = organization.id)
        AND NOT EXISTS (SELECT 1 FROM affiliation_offer_dismissals dismissal WHERE dismissal.user_id = person.id AND dismissal.organization_id = organization.id)
        AND EXISTS (SELECT 1 FROM affiliation_reviews review WHERE review.user_id = person.id AND review.group_key = ?
          AND review.resolved_at IS NULL AND review.normalized_name = organization.normalized_name)
      GROUP BY claim.organization_id, person.normalized_email`,
    bindings: [userId, groupKey],
  };
}

export async function overrideAffiliationReviewVerification(
  db: DatabaseLike,
  input: {
    userId: string;
    groupKey: string;
    decisionId: string;
    activation: NonNullable<AffiliationReviewApprove["activation"]>;
  },
  actor: IdentityManagerActor,
): Promise<number> {
  const eligibility = overrideEvidence(input.userId, input.groupKey);
  const candidates = await all<{ organization_id: string; normalized_email: string }>(
    db,
    `${eligibility.sql} LIMIT 2`,
    [...eligibility.bindings],
  );
  if (candidates.length !== 1) return 0;
  const candidate = candidates[0];
  const created = await createOrganizationIdentity(db, actor, {
    organizationId: candidate.organization_id,
    userId: input.userId,
    showOnOrganizationProfile: true,
    activation: input.activation,
    reviewApproval: {
      groupKey: input.groupKey,
      decisionId: input.decisionId,
      eligibility: {
        sql: `SELECT 1 WHERE EXISTS (SELECT 1 FROM (${eligibility.sql}) candidate WHERE candidate.organization_id = ? AND candidate.normalized_email = ?)`,
        bindings: [...eligibility.bindings, candidate.organization_id, candidate.normalized_email],
      },
    },
  });
  return created.resolvedReviews;
}
