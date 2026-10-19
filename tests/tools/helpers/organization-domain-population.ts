/**
 * Applies the shared domain rule (assets/shared/organization-domain.ts) to a
 * whole fixture population the way migration 0038 orders it: each legacy
 * person's best verified work domain resolves to the organization that owns
 * it, a non-member organization is joined automatically, and everything else
 * (a member organization, free mail, an unknown domain, a name alone, an
 * earlier relationship) leaves the profile's text for review.
 */
import { DatabaseSync } from "node:sqlite";
import { domainLinkMode, resolveDomainOrganization } from "../../../assets/shared/organization-domain";
import { organizationDomainCandidates } from "../../../functions/_lib/email-domains/classification";
import { normalizeOrgName } from "../../../assets/shared/organization-name";
import type {
  FixtureOutcome,
  FixturePerson,
  OrganizationDomainFixture,
} from "../../fixtures/organization-domain-people";

/**
 * The domain an address links through, as the runtime decides it: the most
 * specific claimed (or application-held) domain covering it, else its own
 * domain. Null for free and disposable mail. The fixture's unclaimed work
 * addresses sit directly on their registrable domain, where the migration's
 * host and the runtime's registrable domain agree.
 */
function linkDomain(email: string, claims: Set<string>): string | null {
  const candidates = organizationDomainCandidates(email);
  if (candidates.length === 0) return null;
  return candidates.find((candidate) => claims.has(candidate)) ?? candidates[candidates.length - 1]!;
}

function workDomain(person: FixturePerson, claimed: Set<string>, pending: Set<string>): string | null {
  const claims = new Set([...claimed, ...pending]);
  const addresses = [
    { email: person.email, verified: person.verified, preference: 0 },
    ...(person.secondary ?? []).map((address) => ({ ...address, preference: 1 })),
  ]
    .filter((address) => address.verified)
    .flatMap((address) => {
      const domain = linkDomain(address.email, claims);
      return domain ? [{ ...address, domain }] : [];
    })
    .filter((address) => !pending.has(address.domain))
    .sort(
      (left, right) =>
        Number(claimed.has(right.domain)) - Number(claimed.has(left.domain)) || left.preference - right.preference,
    );
  return addresses[0]?.domain ?? null;
}

/** Each legacy person's outcome under the TypeScript rule, by person id. */
export function decidePopulation(fixture: OrganizationDomainFixture): Record<string, FixtureOutcome> {
  const claimedBy = new Map(
    fixture.organizations.filter((org) => org.claimedDomain).map((org) => [org.claimedDomain!, org]),
  );
  const pending = new Set(fixture.organizations.flatMap((org) => (org.pendingDomain ? [org.pendingDomain] : [])));
  const outcomes: Record<string, FixtureOutcome> = {};
  for (const person of fixture.people) {
    if ((person.identities ?? []).some((identity) => !identity.ended)) continue;
    const domain = workDomain(person, new Set(claimedBy.keys()), pending);
    const owner = domain ? claimedBy.get(domain) : undefined;
    // No identity carries a verified domain before 0038, so there are no derived facts yet.
    const resolution = resolveDomainOrganization({
      claimed: owner ? { organizationId: owner.id, isMember: Boolean(owner.member) } : null,
      heldByApplication: false,
      derived: [],
    });
    const joined =
      resolution.kind === "organization" &&
      domainLinkMode(resolution) === "automatic" &&
      !(person.identities ?? []).some((identity) => identity.organizationId === resolution.organizationId);
    if (joined)
      outcomes[person.id] = {
        organization: fixture.organizations.find((org) => org.id === resolution.organizationId)!.name,
        matchedBy: resolution.via === "claim" ? "verified_domain_claim" : "derived_domain",
      };
    else if (person.organizationName?.trim()) outcomes[person.id] = { review: true };
  }
  return outcomes;
}

const T0 = "2025-01-01T00:00:00.000Z";

/** Writes the fixture into a database that has every migration before 0038. */
export function seedPopulation(db: DatabaseSync, fixture: OrganizationDomainFixture): void {
  const organization = db.prepare(
    "INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const claim = db.prepare(
    `INSERT INTO organization_domain_claims (id, domain, application_id, organization_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const member = db.prepare(
    "INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at) VALUES (?, 'organization', ?, 'active', ?, ?)",
  );
  const application = db.prepare(
    `INSERT INTO member_applications (id, applicant_email, applicant_name, organization_name, organization_domain,
       membership_category, stage_entered_at, manage_token_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, (SELECT code FROM membership_categories ORDER BY code LIMIT 1), ?, ?, ?, ?)`,
  );
  for (const org of fixture.organizations) {
    organization.run(org.id, org.name, normalizeOrgName(org.name), T0, T0);
    if (org.claimedDomain) claim.run(`claim-${org.id}`, org.claimedDomain, null, org.id, T0, T0);
    if (org.member) member.run(`member-${org.id}`, org.id, T0, T0);
    if (org.pendingDomain) {
      application.run(
        `application-${org.id}`,
        `apply@${org.pendingDomain}`,
        "Applicant",
        org.name,
        org.pendingDomain,
        T0,
        `hash-${org.id}`,
        T0,
        T0,
      );
      claim.run(`claim-${org.id}`, org.pendingDomain, `application-${org.id}`, null, T0, T0);
    }
  }
  const user = db.prepare(
    `INSERT INTO users (id, email, normalized_email, organization_name, job_title, email_verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const address = db.prepare(
    "INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const identity = db.prepare(
    `INSERT INTO identities (id, user_id, organization_id, source, invited_at, started_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, 'staff', ?, ?, ?, ?, ?)`,
  );
  for (const person of fixture.people) {
    user.run(
      person.id,
      person.email,
      person.email.toLowerCase(),
      person.organizationName,
      person.jobTitle ?? null,
      person.verified ? T0 : null,
      T0,
      T0,
    );
    for (const secondary of person.secondary ?? [])
      address.run(
        secondary.id,
        person.id,
        secondary.email,
        secondary.email.toLowerCase(),
        secondary.verified ? T0 : null,
        T0,
      );
    for (const [index, held] of (person.identities ?? []).entries())
      identity.run(
        `identity-${person.id}-${index}`,
        person.id,
        held.organizationId,
        T0,
        T0,
        held.ended ? "2025-02-01T00:00:00.000Z" : null,
        T0,
        T0,
      );
  }
}

/** Each fixture person's outcome as the migration left it, by person id. */
export function migratedOutcomes(db: DatabaseSync): Record<string, FixtureOutcome> {
  const outcomes: Record<string, FixtureOutcome> = {};
  const linked = db
    .prepare(
      `SELECT identity.user_id, organization.name, json_extract(entry.details_json, '$.matchedBy.to') AS matched_by
         FROM audit_log entry
         JOIN identities identity ON identity.id = entry.entity_id
         JOIN organizations organization ON organization.id = identity.organization_id
        WHERE entry.action = 'identity_created_from_profile' AND identity.organization_id IS NOT NULL`,
    )
    .all() as Array<{ user_id: string; name: string; matched_by: string }>;
  for (const row of linked) outcomes[row.user_id] = { organization: row.name, matchedBy: row.matched_by };
  const reviewed = db
    .prepare(
      "SELECT DISTINCT user_id FROM affiliation_reviews WHERE source_type = 'user_profile' AND organization_name IS NOT NULL",
    )
    .all() as Array<{ user_id: string }>;
  for (const row of reviewed) outcomes[row.user_id] = { review: true };
  return outcomes;
}
