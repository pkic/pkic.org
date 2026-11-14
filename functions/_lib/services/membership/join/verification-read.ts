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

export function joinLinkConsumedSelection(capabilityId: string): SqlSelection {
  return {
    sql: "SELECT id FROM audit_log WHERE idempotency_key=?",
    bindings: [`membership_join_link_consumed:${capabilityId}`],
  };
}

/** One mailbox-proof observation for join verification and read-only previews. */
export function prepareJoinAffiliationRead(
  db: DatabaseLike,
  email: string,
  selection?: { domain?: string; organizationName?: string },
) {
  return workEmailDomain(email)
    ? prepareVerifiedAffiliationRead(
        db,
        provedMailboxUserIdSelection(email),
        { email, emailId: null, domain: selection?.domain, organizationName: selection?.organizationName },
        { verifiedAt: nowIso() },
      )
    : null;
}

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
  // A chosen organization may claim any of the address's domains, such as the parent the person selected;
  // without a choice, only the sole claimant of the most specific claimed domain.
  const organization = {
    sql: organizationId
      ? `SELECT entry.organization_id FROM organization_domain_claims entry
          WHERE entry.organization_id=? AND entry.domain IN (SELECT value FROM json_each(?))
          ORDER BY length(entry.domain) DESC LIMIT 1`
      : `SELECT entry.organization_id FROM organization_domain_claims entry
          WHERE entry.domain=(SELECT domain FROM (${claim.sql})) AND entry.organization_id IS NOT NULL
            AND (SELECT COUNT(*) FROM organization_domain_claims candidate WHERE candidate.domain=entry.domain)=1
          LIMIT 1`,
    bindings: organizationId ? [organizationId, JSON.stringify(organizationDomainCandidates(email))] : claim.bindings,
  };
  const creation = identityCreationSelections(owner, organization);
  const affiliation = prepareJoinAffiliationRead(db, email, selection);
  const reads: SqlSelection[] = [
    emailOwnershipSelection(email),
    provedMailboxUserSelection(email),
    eligibleMembershipSelection(owner),
    joinLinkConsumedSelection(capabilityId),
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
    organizationOpenApplicationSelection(organization),
    {
      sql: `SELECT organization_id FROM members WHERE status='active' AND organization_id IN (
        SELECT organization_id FROM organization_domain_claims WHERE domain IN (SELECT value FROM json_each(?))
      ) LIMIT 129`,
      bindings: [JSON.stringify(organizationDomainCandidates(email))],
    },
    // The domain the chosen organization claims, which the access guards check, not another organization's claim.
    {
      sql: `SELECT domain FROM organization_domain_claims
        WHERE organization_id=? AND domain IN (SELECT value FROM json_each(?)) ORDER BY length(domain) DESC LIMIT 1`,
      bindings: [organizationId ?? null, JSON.stringify(organizationDomainCandidates(email))],
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
    claim: batchFirst<{ domain: string }>(results[4]),
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
      organizationOpen: batchFirst<{ id: string }>(results[12]) !== null,
    },
    activeMemberOrganizationIds: new Set(
      batchRows<{ organization_id: string }>(results[13]).map((row) => row.organization_id),
    ),
    selectedClaimDomain: batchFirst<{ domain: string }>(results[14])?.domain ?? null,
    affiliation: affiliation?.decode(results.slice(reads.length)) ?? null,
  };
}
