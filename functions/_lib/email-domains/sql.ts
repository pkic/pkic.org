/**
 * SQL that holds when a host is a domain or one of its subdomains
 * (`mail.ibm.com` and `ibm.com` are both within `ibm.com`; `notibm.com` is not).
 *
 * A host name holds only `a-z`, `0-9`, `.` and `-`, so a `/` closing both
 * operands can only meet at the end: `.domain/` occurs in `.host/` exactly
 * when the host ends in that dot-bounded domain. INSTR compares case-sensitively
 * like the lower-case values it reads, and unlike a GLOB or LIKE pattern it is
 * outside D1's 50-byte pattern budget, which a long domain would exceed. Each
 * operand appears once, so a `?` takes one binding.
 */
export function hostWithinDomainSql(hostSql: string, domainSql: string): string {
  return `(instr('.' || ${hostSql} || '/', '.' || ${domainSql} || '/') > 0)`;
}

/** A host follows its most specific current claim, including an application that holds it. */
export function governingDomainClaimSql(hostSql: string, claimAlias = "claim"): string {
  return `${hostWithinDomainSql(hostSql, `${claimAlias}.domain`)} AND NOT EXISTS (
    SELECT 1 FROM organization_domain_claims more_specific
    WHERE length(more_specific.domain)>length(${claimAlias}.domain)
      AND ${hostWithinDomainSql(hostSql, "more_specific.domain")})`;
}
