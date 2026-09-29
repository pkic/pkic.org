import { describe, expect, it } from "vitest";
import type { PublicSponsor } from "../../assets/shared/schemas/public-sponsors";
import { sponsorWeightClass, sponsorWeightsDescending } from "../../assets/ts/member-flows/sponsors-wall";
import { mergeSponsorDisplayPages, sponsorQueryForTest } from "../../assets/ts/member-flows/sponsors-wall-data";

function sponsor(weight: number): PublicSponsor {
  return {
    id: crypto.randomUUID(),
    name: `Sponsor ${weight}`,
    website: null,
    logoUrl: null,
    tier: null,
    eventTier: null,
    effectiveTier: `Tier ${weight}`,
    weight,
  };
}

describe("sponsorWeightsDescending", () => {
  it("keeps every configured weight instead of silently stopping at a compiled maximum", () => {
    expect(sponsorWeightsDescending([sponsor(1), sponsor(12), sponsor(7), sponsor(12)])).toEqual([12, 7, 1]);
  });

  it("bounds visual scaling without rejecting larger configured weights", () => {
    expect(sponsorWeightClass(12)).toBe("sponsor-weight-8");
    expect(sponsorWeightClass(0)).toBe("sponsor-weight-1");
  });
});

describe("bounded sponsor display transport", () => {
  it("uses one bounded, canonical-identity request for server-grouped displays", () => {
    const query = new URLSearchParams(
      sponsorQueryForTest({
        eventSlug: "pqc-conference-amsterdam-nl",
        eventName: "legacy name that must not override the slug",
        level: "Gold",
        minWeight: 5,
        sort: "-weight",
      }),
    );
    expect(query.get("limit")).toBe("200");
    expect(query.get("offset")).toBe("0");
    expect(query.get("eventSlug")).toBe("pqc-conference-amsterdam-nl");
    expect(query.get("eventName")).toBeNull();
    expect(query.get("level")).toBe("Gold");
    expect(query.get("minWeight")).toBe("5");
    expect(query.get("sort")).toBe("-weight");
    expect(
      new URLSearchParams(sponsorQueryForTest({ eventSlug: "pqc-conference-amsterdam-nl" }, 200)).get("offset"),
    ).toBe("200");
  });

  it("caps a strip request even when the shortcode omits maxItems", () => {
    const query = new URLSearchParams(sponsorQueryForTest({ sort: "-weight" }));
    expect(Number(query.get("limit"))).toBe(200);
    expect(Number(query.get("offset"))).toBe(0);
  });

  it("merges only an explicitly requested next server page and preserves hasMore", () => {
    const first = {
      groups: [{ weight: 8, tierName: "Leader", sponsors: [sponsor(8)] }],
      page: { limit: 200, offset: 0, total: 201, hasMore: true },
    };
    const next = {
      groups: [{ weight: 8, tierName: "Leader", sponsors: [sponsor(8)] }],
      page: { limit: 200, offset: 1, total: 201, hasMore: false },
    };
    const merged = mergeSponsorDisplayPages(first, next);
    expect(merged.groups[0]?.sponsors).toHaveLength(2);
    expect(merged.page).toEqual(next.page);
  });
});
