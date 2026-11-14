import { describe, expect, it } from "vitest";
import {
  resolveDomainOrganization,
  type DerivedDomainFact,
  type DomainOwnershipFacts,
} from "../../assets/shared/organization-domain";

describe("organization domain resolution", () => {
  const shared: DomainOwnershipFacts = {
    claimed: [{ organizationId: "first" }, { organizationId: "second" }],
    derived: [],
    related: [],
  };
  const derived = (organizationId: string, active = true): DerivedDomainFact => ({
    organizationId,
    active,
    disputed: false,
    unknownProvenance: false,
  });

  it("requires a choice when several organizations claim the domain", () => {
    expect(resolveDomainOrganization(shared)).toEqual({ kind: "ambiguous" });
    expect(resolveDomainOrganization(shared, { organizationId: "first" })).toEqual({
      kind: "organization",
      organizationId: "first",
      via: "claim",
    });
    expect(resolveDomainOrganization(shared, { organizationId: "second" })).toEqual({
      kind: "organization",
      organizationId: "second",
      via: "claim",
    });
    expect(resolveDomainOrganization(shared, { organizationId: "unrelated" })).toEqual({ kind: "ambiguous" });
  });

  it("keeps offering a claiming organization after its people have left", () => {
    const left: DomainOwnershipFacts = {
      claimed: [{ organizationId: "first" }, { organizationId: "second" }],
      derived: [derived("first"), derived("second", false)],
      related: [],
    };
    expect(resolveDomainOrganization(left, { organizationId: "second" })).toEqual({
      kind: "organization",
      organizationId: "second",
      via: "claim",
    });
  });

  it("resolves an organization reached through people", () => {
    expect(resolveDomainOrganization({ claimed: [], derived: [derived("reached")], related: [] })).toEqual({
      kind: "organization",
      organizationId: "reached",
      via: "derived",
    });
    expect(
      resolveDomainOrganization(
        { claimed: [], derived: [derived("reached")], related: [] },
        { organizationId: "reached" },
      ),
    ).toEqual({ kind: "organization", organizationId: "reached", via: "derived" });
  });

  it("still asks for a choice when people reached several organizations", () => {
    expect(resolveDomainOrganization({ claimed: [], derived: [derived("a"), derived("b")], related: [] })).toEqual({
      kind: "ambiguous",
    });
  });

  it("keeps the one claimant as the default beside organizations people chose through the domain", () => {
    expect(
      resolveDomainOrganization({ claimed: [{ organizationId: "ibm" }], derived: [derived("ibm-us")], related: [] }),
    ).toEqual({ kind: "organization", organizationId: "ibm", via: "claim" });
  });

  it("offers a parent or subdomain organization only for an explicit choice", () => {
    const facts: DomainOwnershipFacts = {
      claimed: [{ organizationId: "ibm" }],
      derived: [],
      related: [{ organizationId: "ibm-us" }],
    };
    expect(resolveDomainOrganization(facts)).toEqual({ kind: "organization", organizationId: "ibm", via: "claim" });
    expect(resolveDomainOrganization(facts, { organizationId: "ibm-us" })).toEqual({
      kind: "organization",
      organizationId: "ibm-us",
      via: "related",
    });
  });

  it("keeps a parent or subdomain organization related after people chose it through this domain", () => {
    const facts: DomainOwnershipFacts = {
      claimed: [{ organizationId: "ibm-us" }],
      derived: [derived("ibm")],
      related: [{ organizationId: "ibm" }],
    };
    expect(resolveDomainOrganization(facts, { organizationId: "ibm" })).toEqual({
      kind: "organization",
      organizationId: "ibm",
      via: "related",
    });
  });
});
