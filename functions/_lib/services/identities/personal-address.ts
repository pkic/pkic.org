/**
 * Whether a work address is the person's personal address: they said so at
 * sign-in, and no organization has claimed its domain. A claimed domain is
 * never personal, so a later claim asks again.
 *
 * The answer is the existing "I am independent" record
 * (`affiliation_offer_dismissals` with no organization). Sign-in, the
 * affiliation preview and registration all read it through this one rule.
 */
import { first } from "../../db/queries";
import { organizationDomainCandidates } from "../../email-domains/classification";
import type { DatabaseLike } from "../../types";

/** An organization has claimed the address's domain or one of its parents. */
export function claimedDomainSql(email: string) {
  return {
    sql: `SELECT 1 FROM organization_domain_claims claim JOIN json_each(?) requested ON requested.value=claim.domain
      WHERE claim.organization_id IS NOT NULL LIMIT 1`,
    bindings: [JSON.stringify(organizationDomainCandidates(email))],
  };
}

/** The person recorded that they take part without an organization; `userId` is a SQL expression. */
export function saidPersonalSql(userId: string): string {
  return `EXISTS (SELECT 1 FROM affiliation_offer_dismissals WHERE user_id=${userId} AND organization_id IS NULL)`;
}

/** The rule as one SQL expression; `userId` is a SQL expression that carries no bindings. */
export function personalAddressSql(userId: string, email: string) {
  const claimed = claimedDomainSql(email);
  return { sql: `(${saidPersonalSql(userId)} AND NOT EXISTS (${claimed.sql}))`, bindings: claimed.bindings };
}

/** The rule as batch evidence, so a domain claimed after the read refuses the write. */
export function personalAddressEvidence(input: { userId: string; email: string }) {
  const personal = personalAddressSql("owner.id", input.email);
  return {
    sql: `SELECT 1 FROM users owner WHERE owner.id = ? AND ${personal.sql}`,
    bindings: [input.userId, ...personal.bindings],
  };
}

/** Reads the rule for one person and address. */
export async function readPersonalAddress(db: DatabaseLike, input: { userId: string; email: string }) {
  const personal = personalAddressSql("subject.id", input.email);
  const row = await first<{ personal: number }>(
    db,
    `SELECT ${personal.sql} AS personal FROM (SELECT ? AS id) subject`,
    [...personal.bindings, input.userId],
  );
  return Boolean(row?.personal);
}
