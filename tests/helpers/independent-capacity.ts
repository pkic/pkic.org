import {
  INDEPENDENT_CAPACITY_DISCLOSURE_VERSION,
  type IndependentCapacityDisclosure,
} from "../../assets/shared/schemas/independent-capacity";

/** A complete independence disclosure, for any request that takes part as an individual. */
export function independentCapacityFixture(
  overrides: Partial<IndependentCapacityDisclosure> = {},
): IndependentCapacityDisclosure {
  return {
    version: INDEPENDENT_CAPACITY_DISCLOSURE_VERSION,
    organizationConnection: "no",
    noRelatedEngagement: true,
    formerAffiliations: "Example Labs, until 2022",
    currentPosition: "Independent consultant",
    acceptsAccountability: true,
    acknowledgesPolicies: true,
    ...overrides,
  };
}

/**
 * Adds the disclosure to a proposal or speaker-profile body that takes part
 * as an individual, exactly as the identity step does; other bodies pass through.
 */
export function withIndependentCapacity<Body extends Record<string, unknown>>(
  body: Body,
): Body & { independentCapacity?: IndependentCapacityDisclosure } {
  const individual = body.unaffiliatedAttestation === true || body.actingIdentityId === null;
  return individual && body.independentCapacity === undefined
    ? { ...body, independentCapacity: independentCapacityFixture() }
    : body;
}
