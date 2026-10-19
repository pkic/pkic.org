/**
 * Synthetic people and organizations for the shared domain rule
 * (assets/shared/organization-domain.ts).
 *
 * One fixture serves migration 0038 (applied to a pre-0038 database) and the
 * Worker's runtime resolver, so the SQL and the TypeScript rule are held to
 * the same expectations. Every address is synthetic; free-mail addresses use
 * the providers the free-domain list names.
 */

export interface FixtureOrganization {
  id: string;
  name: string;
  member?: boolean;
  claimedDomain?: string;
  /** A domain a pending membership application holds. */
  pendingDomain?: string;
}

export interface FixtureAddress {
  id: string;
  email: string;
  verified: boolean;
}

export interface FixtureIdentity {
  organizationId: string;
  ended?: boolean;
}

export interface FixturePerson {
  id: string;
  email: string;
  verified: boolean;
  organizationName: string | null;
  jobTitle?: string | null;
  secondary?: FixtureAddress[];
  identities?: FixtureIdentity[];
}

/** What a person ends up with: an organization (by name) and how, a review, or nothing. */
export type FixtureOutcome = { organization: string; matchedBy: string } | { review: true } | { none: true };

export interface OrganizationDomainFixture {
  organizations: FixtureOrganization[];
  people: FixturePerson[];
}

export const ORGANIZATION_DOMAIN_FIXTURE: OrganizationDomainFixture = {
  organizations: [
    { id: "org-open", name: "Open Claimed Co", claimedDomain: "open-claimed.example" },
    { id: "org-member", name: "Member Claimed Corp", member: true, claimedDomain: "member.example" },
    { id: "org-acme", name: "Acme PKI Ltd", member: true },
    { id: "org-pending", name: "Pending Applicant", pendingDomain: "pending.example" },
  ],
  people: [
    // A non-member organization's claimed domain joins it, whatever the profile says.
    {
      id: "open-1",
      email: "ana@open-claimed.example",
      verified: true,
      organizationName: "Open Claimed Corporation",
      jobTitle: "CTO",
    },
    { id: "open-2", email: "ben@open-claimed.example", verified: true, organizationName: null },
    // An address on a subdomain follows the claim on its registrable domain.
    { id: "open-sub", email: "fay@mail.open-claimed.example", verified: true, organizationName: null },
    // A verified secondary work address counts when the primary is free mail.
    {
      id: "secondary",
      email: "yan@gmail.com",
      verified: true,
      organizationName: "Open Claimed",
      secondary: [{ id: "secondary-work", email: "yan@open-claimed.example", verified: true }],
    },
    // An unverified address proves nothing.
    { id: "unverified", email: "xia@open-claimed.example", verified: false, organizationName: "Open Claimed" },
    // A member organization is joined only when the person confirms it at sign-in.
    { id: "member-1", email: "cy@member.example", verified: true, organizationName: "Member Claimed" },
    // A name never decides, not even the exact name of an existing organization.
    { id: "acme-text", email: "dee@acme-pki.example", verified: true, organizationName: "Acme PKI Ltd" },
    { id: "free-acme", email: "ned@gmail.com", verified: true, organizationName: "Acme PKI Ltd" },
    // An ISP mailbox, and a host below a free provider, are free mail too.
    { id: "isp", email: "gus@ziggo.nl", verified: true, organizationName: "Acme PKI Ltd" },
    { id: "isp-sub", email: "ivy@mail.yahoo.co.uk", verified: true, organizationName: "Open Claimed" },
    // An unknown business domain creates no organization.
    { id: "newco", email: "eli@newco.example", verified: true, organizationName: "NewCo" },
    // A domain held by a pending application is no one's yet.
    { id: "pending-1", email: "wes@pending.example", verified: true, organizationName: "Pending Applicant" },
    // Someone already representing the organization they wrote keeps their identity and gains the title.
    {
      id: "held-acme",
      email: "lee@gmail.com",
      verified: true,
      organizationName: "Acme PKI Ltd",
      jobTitle: "Lead",
      identities: [{ organizationId: "org-acme" }],
    },
  ],
};

export const ORGANIZATION_DOMAIN_EXPECTED: Record<string, FixtureOutcome> = {
  "open-1": { organization: "Open Claimed Co", matchedBy: "verified_domain_claim" },
  "open-2": { organization: "Open Claimed Co", matchedBy: "verified_domain_claim" },
  "open-sub": { organization: "Open Claimed Co", matchedBy: "verified_domain_claim" },
  secondary: { organization: "Open Claimed Co", matchedBy: "verified_domain_claim" },
  unverified: { review: true },
  "member-1": { review: true },
  "acme-text": { review: true },
  "free-acme": { review: true },
  isp: { review: true },
  "isp-sub": { review: true },
  newco: { review: true },
  "pending-1": { review: true },
};

const FREE_PROVIDERS = ["gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "icloud.com"] as const;
const LEGAL_FORMS = ["", " Inc.", " Ltd", ", LLC", " GmbH", " B.V.", " Corp."] as const;

/**
 * A deterministic population shaped like production's legacy profiles:
 * many organizations with a handful of people each who spell the name in
 * several ways, a few claimed domains, a long tail of single-person domains,
 * and a quarter of people on free mail, some naming a known organization and
 * some not.
 */
export function productionShapedFixture(): OrganizationDomainFixture {
  const organizations: FixtureOrganization[] = [];
  const people: FixturePerson[] = [];
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${String((sequence += 1)).padStart(5, "0")}`;
  const pick = <T>(values: readonly T[], index: number): T => values[index % values.length]!;

  for (let index = 0; index < 360; index += 1) {
    const base = `Vendor ${index.toString(36).toUpperCase()} Security`;
    const domain = `vendor-${index}.example`;
    const existing = index % 3 === 0;
    const claimed = index % 30 === 0;
    if (existing)
      organizations.push({
        id: `org-vendor-${index}`,
        name: `${base}${pick(LEGAL_FORMS, index)}`,
        member: index % 9 === 0,
        claimedDomain: claimed ? domain : undefined,
      });
    const size = index % 10 === 0 ? 12 : index % 4 === 0 ? 1 : 2 + (index % 5);
    for (let person = 0; person < size; person += 1) {
      const spelling = person % 4 === 3 ? base.toUpperCase() : `${base}${pick(LEGAL_FORMS, index + person)}`;
      people.push({
        id: nextId("person"),
        email: `p${person}@${domain}`,
        verified: person % 11 !== 10,
        organizationName: person % 7 === 6 ? null : spelling,
        jobTitle: person % 3 === 0 ? "Engineer" : null,
      });
    }
    // Free-mail colleagues who name the same organization.
    if (index % 2 === 0)
      people.push({
        id: nextId("person"),
        email: `vendor${index}@${pick(FREE_PROVIDERS, index)}`,
        verified: true,
        organizationName: base.toLowerCase(),
      });
  }
  // Free-mail people naming organizations nobody else mentions.
  for (let index = 0; index < 120; index += 1)
    people.push({
      id: nextId("person"),
      email: `independent${index}@${pick(FREE_PROVIDERS, index)}`,
      verified: true,
      organizationName: index % 5 === 0 ? null : `Independent Practice ${index % 40}`,
      jobTitle: index % 5 === 0 ? "Consultant" : null,
    });
  return { organizations, people };
}
