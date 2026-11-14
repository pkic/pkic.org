/**
 * The one rule for which organization a verified email address belongs to.
 *
 * A verified work domain can support several explicitly confirmed organizations.
 * Automatic resolution remains conservative. A single claim identifies an
 * organization; without a claim, the one organization people already reached
 * through a verified address on the domain (a derived domain) does. A person
 * may also choose an organization claiming a parent of their address's domain
 * or a subdomain below it, within the registrable domain, but never a sibling:
 * an address at council.europa.eu reaches europa.eu, not parliament.europa.eu. A person's
 * email challenge is what links an organization to its domain, and that claim
 * stays until someone removes it. Membership plays no part: a member
 * organization and any other organization resolve alike. Free, consumer and
 * disposable domains say nothing about an employer, so an address there is
 * always independent.
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
  /** Organizations claiming the domain. */
  claimed: readonly DomainOrganizationCandidate[];
  /** Every organization a verified address on the domain already reached. */
  derived: readonly DerivedDomainFact[];
  /** Organizations claiming a parent domain or a subdomain of the address; offered only for an explicit choice. */
  related: readonly DomainOrganizationCandidate[];
}

export type DomainOrganizationResolution =
  | { kind: "organization"; organizationId: string; via: "claim" | "derived" | "related" }
  /** Nobody owns the domain yet. */
  | { kind: "none" }
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
    // An organization that claims a parent or subdomain stays there: people who chose it through
    // this address never turn into a claim on this domain.
    const related = facts.related.find((claim) => claim.organizationId === choice.organizationId);
    if (related) return { kind: "organization", organizationId: related.organizationId, via: "related" };
    const selected = facts.derived.find((fact) => fact.organizationId === choice.organizationId);
    return selected && isUsableDerivedFact(selected)
      ? { kind: "organization", organizationId: selected.organizationId, via: "derived" }
      : { kind: "ambiguous" };
  }
  if (facts.claimed.length > 1) return { kind: "ambiguous" };
  // The one claimant stays the default even where people chose other organizations through the domain.
  const claimed = facts.claimed[0];
  if (claimed) return { kind: "organization", organizationId: claimed.organizationId, via: "claim" };
  if (facts.derived.length === 0) return { kind: "none" };
  const [only] = facts.derived;
  if (facts.derived.length > 1 || !isUsableDerivedFact(only!)) return { kind: "ambiguous" };
  return { kind: "organization", organizationId: only!.organizationId, via: "derived" };
}

/** People still reach the organization through the domain, nobody disputes it, and its provenance is recorded. */
function isUsableDerivedFact(fact: DerivedDomainFact): boolean {
  return fact.active && !fact.disputed && !fact.unknownProvenance;
}
