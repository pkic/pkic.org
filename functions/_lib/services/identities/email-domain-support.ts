import { governingDomainClaimSql, hostWithinDomainSql } from "../../email-domains/sql";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { identityOrganizationEmailDomainSql } from "./affiliation-projection";

/** Explicit organization/staff approval is independent of mailbox-derived affiliation. */
export function domainBackedIdentitySql(identity = "identity"): string {
  return `(${identity}.source IN ('verified_email','verified_domain') OR ${identity}.verified_email_domain IS NOT NULL)`;
}

/** The proved domain or the organization's governing claim must support this address. */
export function identityEmailDomainSupportSql(address: string, identity = "identity", fallbackDomain = "NULL"): string {
  const host = `substr(${address},instr(${address},'@')+1)`;
  return `(${hostWithinDomainSql(host, `COALESCE(${identity}.verified_email_domain,${fallbackDomain})`)} OR EXISTS (
    SELECT 1 FROM organization_domain_claims claim WHERE claim.organization_id=${identity}.organization_id
      AND claim.application_id IS NULL AND ${governingDomainClaimSql(host)}))`;
}

/** Recheck domain-derived authority atomically with an email-binding change. */
export function representationEmailDomainEvidence(identityId: string, emailId: string | null): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM identities identity JOIN users person ON person.id=identity.user_id
      CROSS JOIN (SELECT ? AS email_id) selected
      LEFT JOIN user_emails address ON address.id=selected.email_id AND address.user_id=person.id
      WHERE identity.id=? AND (NOT ${domainBackedIdentitySql()} OR (
      CASE WHEN selected.email_id IS NULL THEN person.email_verified_at IS NOT NULL ELSE address.verified_at IS NOT NULL END
      AND ${identityEmailDomainSupportSql(
        "CASE WHEN selected.email_id IS NULL THEN person.normalized_email ELSE address.normalized_email END",
        "identity",
        identityOrganizationEmailDomainSql("identity.id"),
      )}))`,
    bindings: [emailId, identityId],
  };
}
