import { batchFirst } from "../../../db/pagination";
import type { SqlSelection } from "../../../db/sql-value";
import type { DatabaseLike } from "../../../types";
import { eligibleMembershipSelection, type MemberEligibleUserRow } from "../../../auth/identity-capacities";
import { emailOwnershipSelection, provedMailboxUserIdSelection, type EmailOwnership } from "../../email-ownership";
import { provedMailboxUserSelection, type UserRecord } from "../../users";
import { identityCreationSelections } from "../../identities/creation-read";
import { verifiedOwnedEmailSelection } from "../../identities/owned-email";
import { organizationDomainClaimForEmailSelection } from "../organization-domain-claims";
import { individualMembershipConflictPredicate } from "../capacity-query";

/** Request-owned observations for the existing join planners. Mutation guards remain authoritative. */
export async function readJoinVerification(db: DatabaseLike, email: string, capabilityId: string) {
  const owner = provedMailboxUserIdSelection(email);
  const claim = organizationDomainClaimForEmailSelection(email);
  const organization = { sql: `SELECT organization_id FROM (${claim.sql})`, bindings: claim.bindings };
  const creation = identityCreationSelections(owner, organization);
  const reads: SqlSelection[] = [
    emailOwnershipSelection(email),
    provedMailboxUserSelection(email),
    eligibleMembershipSelection(owner),
    {
      sql: "SELECT id FROM audit_log WHERE idempotency_key=?",
      bindings: [`membership_join_link_consumed:${capabilityId}`],
    },
    claim,
    {
      sql: `SELECT member.id AS member_id,member.organization_id FROM members member
        WHERE member.organization_id=(${organization.sql}) AND member.status='active' LIMIT 1`,
      bindings: organization.bindings,
    },
    {
      sql: `SELECT active,${individualMembershipConflictPredicate("users.id")} AS individual_conflict
        FROM users WHERE id=(${owner.sql})`,
      bindings: owner.bindings,
    },
    {
      sql: `SELECT id FROM identities WHERE user_id=(${owner.sql})
        AND organization_id=(${organization.sql}) AND blocked_at IS NOT NULL LIMIT 1`,
      bindings: [...owner.bindings, ...organization.bindings],
    },
    creation.unresolved,
    creation.latest,
    verifiedOwnedEmailSelection(owner, email),
  ];
  const results = await db.batch(reads.map((read) => db.prepare(read.sql).bind(...read.bindings)));
  const address = batchFirst<{ id: string; identity_id: string | null }>(results[10]);
  return {
    ownership: batchFirst<EmailOwnership>(results[0]),
    person: batchFirst<UserRecord>(results[1]),
    existingMembership: batchFirst<MemberEligibleUserRow>(results[2]),
    consumed: batchFirst<{ id: string }>(results[3]) !== null,
    claim: batchFirst<{ domain: string; application_id: string | null }>(results[4]),
    member: batchFirst<{ member_id: string; organization_id: string }>(results[5]),
    state: batchFirst<{ active: number; individual_conflict: number }>(results[6]),
    blocked: batchFirst<{ id: string }>(results[7]) !== null,
    address,
    creation: {
      unresolved: batchFirst<{ id: string; started_at: string | null; blocked_at: string | null }>(results[8]),
      latest: batchFirst<{ id: string }>(results[9]),
      emailOwner: address,
    },
  };
}
