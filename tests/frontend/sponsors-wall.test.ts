import { describe, expect, it } from "vitest";
import type { PublicSponsor } from "../../assets/shared/schemas/public-sponsors";
import { sponsorWeightClass, sponsorWeightsDescending } from "../../assets/ts/member-flows/sponsors-wall";

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
