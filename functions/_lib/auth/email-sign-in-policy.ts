/**
 * Which of an account's addresses sign in. Every verified address does, the
 * primary one included, while it still speaks for the person:
 *
 * - An added address bound to an organization identity signs in while that
 *   identity is active (started, not ended, not blocked).
 * - Any other address, the primary one included, stops signing in once a
 *   representation that its domain supported has ended: the person had one or
 *   more organization identities backed by that domain and none is active now.
 *   A reused work mailbox then no longer unlocks the account. An address no
 *   such identity ever covered, such as a personal one, keeps signing in.
 *
 * A session made through an address carries a marker naming it, and lives only
 * while that address is still on the account and still signs in.
 */
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { hostWithinDomainSql } from "../email-domains/sql";
import { domainBackedIdentitySql } from "../services/identities/email-domain-support";

/**
 * `EXISTS` over `table` rows meeting `conditions`, stated as a join condition.
 * These checks run inside every session check, and D1 caps an expression's
 * depth at 100. SQLite counts a subquery's WHERE terms about twice toward that
 * depth but a join's ON terms once, so the policy keeps its conditions there.
 */
function existsSql(table: string, alias: string, conditions: string): string {
  return `EXISTS (SELECT 1 FROM (SELECT 1) ${alias}_anchor JOIN ${table} ${alias} ON ${conditions})`;
}

/**
 * An unproved primary claim cannot unlock an account established through another verified mailbox.
 * `ignoredEmailId` is a SQL expression for an address to leave out, one about to be removed.
 */
export function primaryEmailProofMayAuthenticateSql(person: string, ignoredEmailId?: string): string {
  return `(${person}.email_verified_at IS NOT NULL OR NOT ${existsSql(
    "user_emails",
    "verified",
    `verified.user_id=${person}.id AND verified.verified_at IS NOT NULL${
      ignoredEmailId ? ` AND verified.id IS NOT ${ignoredEmailId}` : ""
    }`,
  )})`;
}

/**
 * A SQL expression naming an identity to treat as already ended, so a guard
 * can ask what would still sign in after the person ends it. "NULL" for none.
 */
type EndingIdentity = string;

/** Ownership of an address can outlive the representation that previously used it. */
export function ownedEmailRepresentationActiveSql(address: string, ending: EndingIdentity = "NULL"): string {
  return `(${address}.identity_id IS NULL OR ${existsSql(
    "identities",
    "owner_identity",
    `(owner_identity.id = ${address}.identity_id AND owner_identity.user_id = ${address}.user_id
       AND owner_identity.started_at IS NOT NULL) AND (owner_identity.ended_at IS NULL
       AND owner_identity.blocked_at IS NULL AND owner_identity.id IS NOT ${ending})`,
  )})`;
}

/**
 * Holds while no ended representation retired this address: no started,
 * domain-backed organization identity of `userId` covers its domain, or one
 * that does is still active. An identity covers the address when its proved
 * domain or one of its organization's claimed domains holds the address's host.
 *
 * Written as one flat aggregate rather than the general domain-support rule
 * (which also weighs more specific claims) because this runs inside every
 * session check, and D1 caps an expression's depth at 100.
 */
export function addressNotRetiredSql(userId: string, normalizedEmail: string, ending: EndingIdentity = "NULL"): string {
  const host = `substr(${normalizedEmail}, instr(${normalizedEmail}, '@') + 1)`;
  return `COALESCE((SELECT MAX(covering.ended_at IS NULL AND covering.blocked_at IS NULL AND covering.id IS NOT ${ending})
      FROM (SELECT 1) covering_anchor
      JOIN identities covering
        ON (covering.user_id = ${userId} AND covering.organization_id IS NOT NULL)
       AND (covering.started_at IS NOT NULL AND ${domainBackedIdentitySql("covering")})
      LEFT JOIN organization_domain_claims claim
        ON claim.organization_id = covering.organization_id AND claim.application_id IS NULL
     WHERE ${hostWithinDomainSql(host, "covering.verified_email_domain")} OR ${hostWithinDomainSql(host, "claim.domain")}), 1) = 1`;
}

/** The primary address of `person` (aliasing users) may sign in. */
export function primaryEmailSignInAllowedSql(
  person: string,
  options: { ignoredEmailId?: string; ending?: EndingIdentity } = {},
): string {
  return `(${primaryEmailProofMayAuthenticateSql(person, options.ignoredEmailId)}
    AND ${addressNotRetiredSql(`${person}.id`, `${person}.normalized_email`, options.ending)})`;
}

/** An added address (aliasing user_emails) may sign in. */
export function addedEmailSignInAllowedSql(address: string, ending: EndingIdentity = "NULL"): string {
  return `(${address}.verified_at IS NOT NULL AND CASE WHEN ${address}.identity_id IS NULL
    THEN ${addressNotRetiredSql(`${address}.user_id`, `${address}.normalized_email`, ending)}
    ELSE ${ownedEmailRepresentationActiveSql(address, ending)} END)`;
}

/** The account `person` (aliasing users) may still be signed in to. */
export function liveAccountSql(person: string): string {
  return `${person}.active = 1 AND ${person}.pii_redacted_at IS NULL AND ${person}.merged_into_user_id IS NULL`;
}

/**
 * Holds while `normalizedEmail` is still on account `userId`, as its primary
 * address or an added one, and still signs in. Swapping which one is primary
 * keeps the address, so it keeps the sessions made through it.
 */
export function accountAddressSignsInSql(userId: string, normalizedEmail: string): string {
  return `(${existsSql(
    "users",
    "signing_person",
    `(signing_person.id = ${userId} AND signing_person.normalized_email = ${normalizedEmail})
      AND ${primaryEmailSignInAllowedSql("signing_person")}`,
  )} OR ${existsSql(
    "user_emails",
    "signing_address",
    `(signing_address.user_id = ${userId} AND signing_address.normalized_email = ${normalizedEmail})
      AND ${addedEmailSignInAllowedSql("signing_address")}`,
  )})`;
}

/** Recheck the address a sign-in uses inside the session's atomic command. */
export function signInEmailAuthorizationEvidence(input: {
  userId: string;
  normalizedEmail: string;
}): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM (SELECT ? AS normalized_email) signing CROSS JOIN users person
      WHERE person.id = ? AND ${liveAccountSql("person")}
      AND ${accountAddressSignsInSql("person.id", "signing.normalized_email")}`,
    bindings: [input.normalizedEmail, input.userId],
  };
}

/** A session made through an address ends with that address; one without a marker (a passkey) is unaffected. */
export function sessionEmailSignInAllowedSql(sessionId: string, userId: string): string {
  return `NOT ${existsSql(
    "session_email_authentication",
    "authentication",
    `authentication.session_id = ${sessionId}
      AND NOT ${accountAddressSignsInSql(userId, "authentication.normalized_email")}`,
  )}`;
}
