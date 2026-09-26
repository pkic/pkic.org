// @vitest-environment jsdom
/**
 * The company key's grammar, and the response contract the company page reads.
 *
 * The key is built server-side in `listSponsorshipCompanies`; the panel turns
 * it back into a filter the sponsorships endpoint takes, so a company's page
 * is one bounded D1 query. Paging and merging used to live here too — that is
 * the shared table's work now, and it is exercised through the panel in
 * portal-sponsor-company-detail-panel.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { sponsorshipsListResponseSchema } from "../../assets/shared/schemas/sponsorship-management";
import { companyDetailParams } from "../../assets/ts/member-flows/portal/sections/sponsors/management/companyKey";
import type { Sponsorship } from "../../assets/shared/schemas/sponsorship-management";

function sponsorship(id: string): Sponsorship {
  return {
    id,
    sponsorType: "consortium",
    organizationId: null,
    organizationName: null,
    nonMemberName: null,
    nonMemberWebsite: null,
    nonMemberLogoUrl: null,
    contactName: null,
    contactEmail: null,
    eventId: null,
    eventName: null,
    tier: null,
    pipelineStage: "active",
    startDate: null,
    renewalDate: null,
    assignedToUserId: null,
    assignedToName: null,
    notes: null,
    priceAmountCents: null,
    priceCurrency: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("companyDetailParams", () => {
  it("decomposes an org-keyed company row", () => {
    expect(companyDetailParams("org:abc-123")).toEqual({ organizationId: "abc-123" });
  });

  it("decomposes a non-member-keyed company row", () => {
    expect(companyDetailParams("nonmember:Acme Inc")).toEqual({ nonMemberName: "Acme Inc" });
  });

  it("decomposes a contact-keyed company row", () => {
    expect(companyDetailParams("contact:Jane Doe")).toEqual({ contactName: "Jane Doe" });
  });

  it("names a sponsorship that groups under itself, so its page is a list query too", () => {
    expect(companyDetailParams("sponsorship:abc-123")).toEqual({ sponsorshipId: "abc-123" });
  });
});

describe("company sponsorship response contract", () => {
  const validResponse = {
    sponsorships: [sponsorship("00000000-0000-4000-8000-000000000001")],
    page: { limit: 200, offset: 0, total: 1, hasMore: false },
  };

  it("accepts the canonical paginated sponsorship response", () => {
    expect(sponsorshipsListResponseSchema.safeParse(validResponse).success).toBe(true);
  });

  it("rejects a malformed page envelope", () => {
    expect(
      sponsorshipsListResponseSchema.safeParse({
        ...validResponse,
        page: { limit: 200, offset: -1, total: 1, hasMore: false },
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed sponsorship row", () => {
    expect(
      sponsorshipsListResponseSchema.safeParse({
        ...validResponse,
        sponsorships: [{ ...validResponse.sponsorships[0], pipelineStage: "not-a-stage" }],
      }).success,
    ).toBe(false);
  });
});
