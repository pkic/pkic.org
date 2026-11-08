import { batchFirst, batchRows } from "../../../db/pagination";
import type { SqlSelection } from "../../../db/sql-value";
import type { DatabaseLike } from "../../../types";
import { eligibleMembershipSelection, type MemberEligibleUserRow } from "../../../auth/identity-capacities";
import { emailOwnershipSelection, provedMailboxUserIdSelection, type EmailOwnership } from "../../email-ownership";
import { provedMailboxUserSelection, type UserRecord } from "../../users";
import { identityCreationSelections } from "../../identities/creation-read";
import { verifiedOwnedEmailSelection } from "../../identities/owned-email";
import { organizationDomainClaimForEmailSelection } from "../organization-domain-claims";
import { individualMembershipConflictPredicate } from "../capacity-query";
import { organizationDomainCandidates, workEmailDomain } from "../../../email-domains/classification";
import { nowIso } from "../../../utils/time";
import { prepareVerifiedAffiliationRead } from "../../identities/verified-affiliation-read";
import {
  organizationOpenApplicationSelection,
  ownOpenApplicationSelection,
  type OwnOpenApplicationRow,
} from "./open-application";

/** Request-owned observations for the existing join planners. Mutation guards remain authoritative. */
export async function readJoinVerification(
  db: DatabaseLike,
  email: string,
  capabilityId: string,
  organizationId?: string,
  selection?: { domain?: string; organizationName?: string },
) {
  const owner = provedMailboxUserIdSelection(email);
  const claim = organizationDomainClaimForEmailSelection(email);
  const organization = {
    sql: `SELECT entry.organization_id FROM organization_domain_claims entry
      WHERE entry.domain=(SELECT domain FROM (${claim.sql})) AND entry.organization_id IS NOT NULL
        AND ((? IS NOT NULL AND entry.organization_id=?) OR (? IS NULL AND
          (SELECT COUNT(*) FROM organization_domain_claims candidate WHERE candidate.domain=entry.domain)=1)) LIMIT 1`,
    bindings: [...claim.bindings, organizationId ?? null, organizationId ?? null, organizationId ?? null],
  };
  const creation = identityCreationSelections(owner, organization);
  const affiliation = workEmailDomain(email)
    ? prepareVerifiedAffiliationRead(
        db,
        owner,
        { email, emailId: null, domain: selection?.domain, organizationName: selection?.organizationName },
        { verifiedAt: nowIso() },
      )
    : null;
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
    ownOpenApplicationSelection(email, owner),
    organizationOpenApplicationSelection(claim),
    {
      sql: `SELECT organization_id FROM members WHERE status='active' AND organization_id IN (
        SELECT organization_id FROM organization_domain_claims WHERE domain IN (SELECT value FROM json_each(?))
      ) LIMIT 129`,
      bindings: [JSON.stringify(organizationDomainCandidates(email))],
    },
  ];
  const results = await db.batch([
    ...reads.map((read) => db.prepare(read.sql).bind(...read.bindings)),
    ...(affiliation?.statements ?? []),
  ]);
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
    openApplication: {
      own: batchFirst<OwnOpenApplicationRow>(results[11]),
      organizationHeld: batchFirst<{ id: string }>(results[12]) !== null,
    },
    activeMemberOrganizationIds: new Set(
      batchRows<{ organization_id: string }>(results[13]).map((row) => row.organization_id),
    ),
    affiliation: affiliation?.decode(results.slice(reads.length)) ?? null,
  };
}
