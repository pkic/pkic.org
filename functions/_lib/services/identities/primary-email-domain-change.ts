/** End only domain-backed representations that lose their last verified supporting mailbox. */
import type { DatabaseLike, StatementLike } from "../../types";
import { emailDomainOf } from "../../../../assets/shared/schemas/email-domains";
import { hostWithinDomainSql } from "../../email-domains/sql";
import { prepareSitePublicationRequestSelection } from "../site-publication-requests";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { domainBackedIdentitySql, identityEmailDomainSupportSql } from "./email-domain-support";

export function preparePrimaryEmailDomainChange(
  db: DatabaseLike,
  input: { userId: string; previousEmail: string; nextEmail: string; at: string },
): StatementLike[] {
  if (emailDomainOf(input.previousEmail) === emailDomainOf(input.nextEmail)) return [];
  const supports = (address: string) => identityEmailDomainSupportSql(address, "identity", "?");
  const oldDomain = emailDomainOf(input.previousEmail);
  const affected = {
    sql: `SELECT identity.id AS resource_id FROM identities identity WHERE identity.user_id=?
      AND identity.organization_id IS NOT NULL AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL
      AND identity.blocked_at IS NULL AND identity.email_id IS NULL
      AND ${domainBackedIdentitySql()}
      AND ${hostWithinDomainSql("?", "COALESCE(identity.verified_email_domain,?)")}
      AND NOT EXISTS (SELECT 1 FROM users person WHERE person.id=identity.user_id AND person.active=1 AND person.email_verified_at IS NOT NULL AND ${supports("person.normalized_email")})`,
    bindings: [input.userId, oldDomain, oldDomain, oldDomain],
  };
  const selection = {
    sql: `${affected.sql} AND NOT EXISTS (SELECT 1 FROM user_emails address WHERE address.user_id=identity.user_id AND address.verified_at IS NOT NULL
        AND ${supports("address.normalized_email")})`,
    bindings: [...affected.bindings, oldDomain],
  };
  const supportingAddress = `SELECT address.id FROM user_emails address
    WHERE address.user_id=identity.user_id AND address.verified_at IS NOT NULL
      AND (address.identity_id IS NULL OR address.identity_id=identity.id)
      AND ${supports("address.normalized_email")}
    ORDER BY CASE WHEN address.identity_id=identity.id THEN 0 ELSE 1 END,address.created_at,address.id LIMIT 1`;
  return [
    prepareSitePublicationRequestSelection(
      db,
      {
        resourceType: "identity_profile",
        revision: Date.parse(input.at),
        reasonCode: "identity_profile_changed",
        deduplicationKey: `email-domain:${crypto.randomUUID()}`,
      },
      affected,
    ),
    db
      .prepare(`INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,details_json,created_at)
      SELECT lower(hex(randomblob(16))),'user',?,'organization_identity_ended','identity',ending.resource_id,
        json_object('endedAt',?,'ended_by','email_domain_change'),? FROM (${selection.sql}) ending`)
      .bind(input.userId, input.at, input.at, ...selection.bindings),
    db
      .prepare(`UPDATE identities SET ended_at=MAX(started_at,?),updated_at=? WHERE id IN (${selection.sql})`)
      .bind(input.at, input.at, ...selection.bindings),
    db
      .prepare(`INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,details_json,created_at)
      SELECT lower(hex(randomblob(16))),'user',?,'organization_identity_email_changed','identity',identity.id,
        json_object('emailId',json_object('from',NULL,'to',(${supportingAddress}))),?
      FROM identities identity WHERE identity.id IN (${affected.sql}) AND (${supportingAddress}) IS NOT NULL`)
      .bind(input.userId, oldDomain, input.at, ...affected.bindings, oldDomain),
    // A surviving representation keeps its supporting work address rather than displaying the new primary domain.
    db
      .prepare(`UPDATE identities AS identity SET email_id=(${supportingAddress}),updated_at=?
      WHERE identity.id IN (${affected.sql}) AND (${supportingAddress}) IS NOT NULL`)
      .bind(oldDomain, input.at, ...affected.bindings, oldDomain),
    db
      .prepare(`UPDATE user_emails AS address SET identity_id=(SELECT identity.id FROM identities identity
      WHERE identity.user_id=? AND identity.email_id=address.id AND identity.ended_at IS NULL AND identity.blocked_at IS NULL)
      WHERE address.user_id=? AND address.identity_id IS NULL AND EXISTS (SELECT 1 FROM identities identity
        WHERE identity.user_id=address.user_id AND identity.email_id=address.id AND identity.ended_at IS NULL AND identity.blocked_at IS NULL)`)
      .bind(input.userId, input.userId),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
  ];
}
