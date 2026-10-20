/** Staff approval uses live mailbox proof, never the name or domain stored in a review. */
import type { AffiliationReviewApprove } from "../../../../assets/shared/schemas/affiliation-reviews";
import { hostWithinDomainSql } from "../../email-domains/sql";
import { all } from "../../db/queries";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { guardPermissionMutationDatabase } from "../../auth/permissions";
import { AppError } from "../../errors";
import { uuid } from "../../utils/ids";
import { getAffiliationReviewGroup } from "./affiliation-reviews";
import { linkVerifiedAddressToDomainOrganization } from "./email-domain-link";

/** Five people keep address resolution, activation, audit, and outbox below Worker statement limits. */
const PEOPLE_PER_PASS = 5;

export async function approveAffiliationReviewGroup(
  db: DatabaseLike,
  groupKey: string,
  input: AffiliationReviewApprove,
  staff: UserBackedAuthAdmin,
) {
  const protectedDb = guardPermissionMutationDatabase(
    db,
    staff,
    [{ permission: "users:write" }, { permission: "identities:activate" }],
    () => new AppError(403, "PERMISSION_REQUIRED", "Affiliation approval permission changed; refresh and try again"),
  );
  await getAffiliationReviewGroup(protectedDb, groupKey);
  const people = await all<{ user_id: string }>(
    db,
    `SELECT DISTINCT user_id FROM affiliation_reviews
      WHERE group_key = ? AND resolved_at IS NULL AND user_id > ? AND (? IS NULL OR user_id = ?)
      ORDER BY user_id LIMIT ${PEOPLE_PER_PASS + 1}`,
    [groupKey, input.afterUserId ?? "", input.userId ?? null, input.userId ?? null],
  );
  const decisionId = uuid();
  let decided = 0;
  for (const person of people.slice(0, PEOPLE_PER_PASS)) {
    const addresses = await all<{ normalized_email: string; organization_id: string }>(
      db,
      `WITH addresses AS (
         SELECT normalized_email FROM users WHERE id = ? AND active = 1 AND email_verified_at IS NOT NULL
         UNION ALL SELECT address.normalized_email FROM user_emails address JOIN users person ON person.id = address.user_id
           WHERE address.user_id = ? AND address.verified_at IS NOT NULL AND person.active = 1
       ) SELECT MIN(address.normalized_email) AS normalized_email, claim.organization_id FROM addresses address
         JOIN organization_domain_claims claim ON claim.application_id IS NULL
           AND ${hostWithinDomainSql("substr(address.normalized_email, instr(address.normalized_email, '@') + 1)", "claim.domain")}
         JOIN organizations organization ON organization.id = claim.organization_id
         WHERE NOT EXISTS (SELECT 1 FROM organization_domain_claims closer
           WHERE length(closer.domain) > length(claim.domain)
             AND ${hostWithinDomainSql("substr(address.normalized_email, instr(address.normalized_email, '@') + 1)", "closer.domain")})
           AND EXISTS (SELECT 1 FROM affiliation_reviews review WHERE review.user_id = ? AND review.group_key = ?
           AND review.resolved_at IS NULL AND ((review.email_domain = claim.domain
             AND (review.normalized_name IS NULL OR review.normalized_name = organization.normalized_name))
             OR review.normalized_name = organization.normalized_name))
         GROUP BY claim.organization_id ORDER BY claim.organization_id LIMIT 2`,
      [person.user_id, person.user_id, person.user_id, groupKey],
    );
    // Multiple possible employers need an explicit identity invitation, not a guess.
    if (addresses.length !== 1) continue;
    for (const address of addresses) {
      const linked = await linkVerifiedAddressToDomainOrganization(protectedDb, {
        userId: person.user_id,
        normalizedEmail: address.normalized_email,
        onlyOrganizationId: address.organization_id,
        reviewDecision: { groupKey, staffId: staff.id, decisionId },
      });
      if (linked) {
        decided += linked.resolvedReviews;
        break;
      }
    }
  }
  return {
    group: await getAffiliationReviewGroup(db, groupKey),
    decided,
    nextUserId: people.length > PEOPLE_PER_PASS ? people[PEOPLE_PER_PASS - 1].user_id : null,
  };
}
