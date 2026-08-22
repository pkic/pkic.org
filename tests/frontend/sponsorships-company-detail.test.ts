// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sponsorshipsListResponseSchema } from "../../assets/shared/schemas/admin-sponsorships";
import {
  companyDetailParams,
  buildCompanySponsorshipsUrl,
  mergeCompanySponsorshipsPage,
} from "../../assets/ts/admin/sections/Sponsorships";
import type { Sponsorship } from "../../assets/ts/admin/types";

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
});

describe("buildCompanySponsorshipsUrl", () => {
  it("builds a bounded, offset-paginated URL with no filters", () => {
    const url = buildCompanySponsorshipsUrl("org:abc-123", {}, 0);
    expect(url).toBe("/api/v1/admin/sponsorships?organizationId=abc-123&limit=200&offset=0");
  });

  it("carries the offset forward for a 'Load more' page", () => {
    const url = buildCompanySponsorshipsUrl("org:abc-123", {}, 200);
    expect(url).toBe("/api/v1/admin/sponsorships?organizationId=abc-123&limit=200&offset=200");
  });

  it("includes type/stage filters when set", () => {
    const url = buildCompanySponsorshipsUrl("nonmember:Acme", { type: "event", stage: "active" }, 0);
    expect(url).toBe("/api/v1/admin/sponsorships?nonMemberName=Acme&limit=200&offset=0&type=event&stage=active");
  });
});

describe("mergeCompanySponsorshipsPage", () => {
  it("replaces rows outright on a fresh offset-0 load", () => {
    const previous = [sponsorship("stale-1")];
    const fetched = {
      sponsorships: [sponsorship("a"), sponsorship("b")],
      page: { limit: 200, offset: 0, total: 2, hasMore: false },
    };

    const result = mergeCompanySponsorshipsPage(previous, 0, fetched);

    expect(result.sponsorships.map((s) => s.id)).toEqual(["a", "b"]);
    expect(result.page.hasMore).toBe(false);
  });

  it("appends onto existing rows for a 'Load more' page instead of dropping earlier ones", () => {
    const previous = [sponsorship("a"), sponsorship("b")];
    const fetched = {
      sponsorships: [sponsorship("c")],
      page: { limit: 200, offset: 200, total: 201, hasMore: false },
    };

    const result = mergeCompanySponsorshipsPage(previous, 200, fetched);

    expect(result.sponsorships.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(result.page.total).toBe(201);
  });

  it("never silently caps rows: total beyond one page still reports hasMore", () => {
    const fetched = {
      sponsorships: Array.from({ length: 200 }, (_, i) => sponsorship(`row-${i}`)),
      page: { limit: 200, offset: 0, total: 250, hasMore: true },
    };

    const result = mergeCompanySponsorshipsPage([], 0, fetched);

    expect(result.sponsorships).toHaveLength(200);
    expect(result.page.total).toBe(250);
    expect(result.page.hasMore).toBe(true);
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
