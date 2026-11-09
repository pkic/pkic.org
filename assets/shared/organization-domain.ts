/**
 * The one rule for which organization a verified email address belongs to.
 *
 * A verified work domain can support several explicitly confirmed organizations.
 * Automatic resolution remains conservative. A single approved claim may
 * identify an organization; without a claim, the one
 * non-member organization people already reached through a verified address
 * on the domain (a derived domain) does. Free, consumer and disposable
 * domains say nothing about an employer, so an address there is always
 * independent. A domain a pending membership application holds belongs to no
 * one yet.
 *
 * Which domain an address speaks for — its registrable domain, or a more
 * specific subdomain an organization claims explicitly — and which domains are
 * free or disposable is the Worker's email-domain classification
 * (`functions/_lib/email-domains`), which holds the vendored lists.
 *
 * Two runtimes apply the rule. The Worker loads the facts for one domain and
 * calls {@link resolveDomainOrganization}; migration 0038 embeds the same
 * decision in SQL, and the tools tests hold the migration's outcomes to this
 * module on shared fixtures.
 */

export interface DomainOrganizationCandidate {
  organizationId: string;
  isMember: boolean;
}

/** An organization people already reached through a verified address on the domain. */
export interface DerivedDomainFact extends DomainOrganizationCandidate {
  /** At least one active, verified-email identity of an active person there. */
  active: boolean;
  /** Someone's relationship there is blocked. */
  disputed: boolean;
  /** Someone's relationship there predates recorded domain provenance. */
  unknownProvenance: boolean;
}

export interface DomainOwnershipFacts {
  /** Organizations holding an approved claim on the domain. */
  claimed: readonly DomainOrganizationCandidate[];
  /** A pending membership application holds the domain. */
  heldByApplication: boolean;
  /** Every organization a verified address on the domain already reached. */
  derived: readonly DerivedDomainFact[];
}

export type DomainOrganizationResolution =
  | { kind: "organization"; organizationId: string; isMember: boolean; via: "claim" | "derived" }
  /** Nobody owns the domain yet. */
  | { kind: "none" }
  /** A pending application holds the domain. */
  | { kind: "held" }
  /** The facts disagree, so staff decide. */
  | { kind: "ambiguous" };

/** Which organization a verified work domain belongs to. */
export function resolveDomainOrganization(
  facts: DomainOwnershipFacts,
  choice?: { organizationId: string | null },
): DomainOrganizationResolution {
  if (choice) {
    if (choice.organizationId === null) return { kind: "none" };
    const selectedClaim = facts.claimed.find((claim) => claim.organizationId === choice.organizationId);
    if (selectedClaim) return { kind: "organization", ...selectedClaim, via: "claim" };
    const selected = facts.derived.find((fact) => fact.organizationId === choice.organizationId);
    return selected && selected.active && !selected.disputed && !selected.unknownProvenance && !selected.isMember
      ? { kind: "organization", organizationId: selected.organizationId, isMember: false, via: "derived" }
      : { kind: "ambiguous" };
  }
  if (facts.heldByApplication)
    return facts.claimed.length || facts.derived.length ? { kind: "ambiguous" } : { kind: "held" };
  if (facts.claimed.length > 1) return { kind: "ambiguous" };
  const claimed = facts.claimed[0];
  if (claimed) {
    const elsewhere = facts.derived.some((fact) => fact.organizationId !== claimed.organizationId);
    return elsewhere
      ? { kind: "ambiguous" }
      : { kind: "organization", organizationId: claimed.organizationId, isMember: claimed.isMember, via: "claim" };
  }
  if (facts.derived.length === 0) return { kind: "none" };
  const [only] = facts.derived;
  if (facts.derived.length > 1 || !only!.active || only!.disputed || only!.unknownProvenance || only!.isMember)
    return { kind: "ambiguous" };
  return { kind: "organization", organizationId: only!.organizationId, isMember: false, via: "derived" };
}

/** Mailbox proof alone cannot grant a new member identity when other organizations share the domain. */
export function requiresMemberAffiliationReview(facts: DomainOwnershipFacts, organizationId: string): boolean {
  return (
    facts.claimed.some((claim) => claim.organizationId === organizationId && claim.isMember) &&
    (facts.heldByApplication ||
      facts.claimed.some((claim) => claim.organizationId !== organizationId) ||
      facts.derived.some((fact) => fact.organizationId !== organizationId && fact.active))
  );
}
