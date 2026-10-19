import { first } from "../../db/queries";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { hostWithinDomainSql } from "../../email-domains/sql";
import type { DatabaseLike } from "../../types";

/**
 * The one projection of the organization and job title a person is shown
 * with. Identities are their single source: nothing else stores either value.
 *
 * A person's affiliation is their primary identity — the one they marked as
 * default, else their earliest-started active organization identity, else an
 * active individual identity. A title held without an organization identity
 * (the identities CHECK keeps titles on organization identities) comes from
 * individual_job_titles.
 *
 * Every builder takes a trusted SQL expression for the user or identity id
 * (an alias column such as `u.id`, or `?`), never caller-supplied text.
 */

const ACTIVE_NOW = `candidate.started_at IS NOT NULL AND candidate.ended_at IS NULL AND candidate.blocked_at IS NULL`;

/** The id of the person's primary active identity, or NULL. */
export function primaryIdentityIdSql(userIdSql: string): string {
  return `(SELECT candidate.id FROM identities candidate
    WHERE candidate.user_id = ${userIdSql} AND ${ACTIVE_NOW}
    ORDER BY candidate.is_default DESC, candidate.organization_id IS NULL, candidate.started_at, candidate.id
    LIMIT 1)`;
}

/** The id of the person's active individual identity, or NULL. */
export function individualIdentityIdSql(userIdSql: string): string {
  return `(SELECT candidate.id FROM identities candidate
    WHERE candidate.user_id = ${userIdSql} AND candidate.organization_id IS NULL AND ${ACTIVE_NOW}
    LIMIT 1)`;
}

/** The organization name an identity speaks for; NULL for an individual identity. */
export function identityOrganizationNameSql(identityIdSql: string): string {
  return `(SELECT affiliation_organization.name FROM identities affiliation_identity
    JOIN organizations affiliation_organization ON affiliation_organization.id = affiliation_identity.organization_id
    WHERE affiliation_identity.id = ${identityIdSql})`;
}

/** The job title an identity carries; an individual identity shows its holder's individual title. */
export function identityJobTitleSql(identityIdSql: string): string {
  return `(SELECT CASE WHEN affiliation_identity.organization_id IS NOT NULL THEN affiliation_identity.job_title
      ELSE affiliation_individual.job_title END
    FROM identities affiliation_identity
    LEFT JOIN individual_job_titles affiliation_individual ON affiliation_individual.user_id = affiliation_identity.user_id
    WHERE affiliation_identity.id = ${identityIdSql})`;
}

/**
 * The email domain an organization identity is linked through: the verified
 * domain it was derived from, else the most specific domain the organization
 * claims that covers its address (the selected one, or the person's primary):
 * `mail.example.com` is linked through a claim on `example.com`. NULL when
 * the tie does not follow an email domain.
 */
export function identityOrganizationEmailDomainSql(identityIdSql: string): string {
  return `(SELECT COALESCE(domain_identity.verified_email_domain, (
      SELECT domain_claim.domain FROM organization_domain_claims domain_claim
       WHERE domain_claim.organization_id = domain_identity.organization_id AND domain_claim.application_id IS NULL
         AND ${hostWithinDomainSql(
           "substr(COALESCE(domain_address.normalized_email, domain_person.normalized_email), instr(COALESCE(domain_address.normalized_email, domain_person.normalized_email), '@') + 1)",
           "domain_claim.domain",
         )}
       ORDER BY length(domain_claim.domain) DESC LIMIT 1))
    FROM identities domain_identity
    JOIN users domain_person ON domain_person.id = domain_identity.user_id
    LEFT JOIN user_emails domain_address
      ON domain_address.id = domain_identity.email_id AND domain_address.user_id = domain_identity.user_id
    WHERE domain_identity.id = ${identityIdSql} AND domain_identity.organization_id IS NOT NULL)`;
}

/** The organization name of the person's primary identity. */
export function affiliationOrganizationNameSql(userIdSql: string): string {
  return identityOrganizationNameSql(primaryIdentityIdSql(userIdSql));
}

/** The job title of the person's primary identity, or their individual title when none is an organization's. */
export function affiliationJobTitleSql(userIdSql: string): string {
  return `(SELECT CASE WHEN affiliation_primary.organization_id IS NOT NULL THEN affiliation_primary.job_title
      ELSE affiliation_individual.job_title END
    FROM users affiliation_person
    LEFT JOIN identities affiliation_primary ON affiliation_primary.id = ${primaryIdentityIdSql("affiliation_person.id")}
    LEFT JOIN individual_job_titles affiliation_individual ON affiliation_individual.user_id = affiliation_person.id
    WHERE affiliation_person.id = ${userIdSql})`;
}

/**
 * A record that names the identity it was made as (a registration, a speaker
 * credit) shows that identity; one that names none shows the person's
 * current affiliation.
 */
export function selectedOrAffiliationOrganizationNameSql(identityIdSql: string, userIdSql: string): string {
  return `CASE WHEN ${identityIdSql} IS NOT NULL THEN ${identityOrganizationNameSql(identityIdSql)}
    ELSE ${affiliationOrganizationNameSql(userIdSql)} END`;
}

export function selectedOrAffiliationJobTitleSql(identityIdSql: string, userIdSql: string): string {
  return `CASE WHEN ${identityIdSql} IS NOT NULL THEN ${identityJobTitleSql(identityIdSql)}
    ELSE ${affiliationJobTitleSql(userIdSql)} END`;
}

export interface Affiliation {
  identityId: string | null;
  organizationName: string | null;
  jobTitle: string | null;
  biography: string | null;
  links: string[];
}

/** Reads one person's affiliation — their primary identity's profile — for code that needs values rather than SQL. */
export async function readAffiliation(db: DatabaseLike, userId: string): Promise<Affiliation> {
  const row = await first<{
    identity_id: string | null;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
  }>(
    db,
    `SELECT primary_identity.id AS identity_id,
            ${affiliationOrganizationNameSql("person.id")} AS organization_name,
            ${affiliationJobTitleSql("person.id")} AS job_title,
            primary_identity.biography, primary_identity.links_json
       FROM users person
       LEFT JOIN identities primary_identity ON primary_identity.id = ${primaryIdentityIdSql("person.id")}
      WHERE person.id = ?`,
    [userId],
  );
  return {
    identityId: row?.identity_id ?? null,
    organizationName: row?.organization_name ?? null,
    jobTitle: row?.job_title ?? null,
    biography: row?.biography ?? null,
    links: parseLinksJson(row?.links_json ?? null),
  };
}
