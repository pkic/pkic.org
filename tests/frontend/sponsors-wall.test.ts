import { describe, expect, it, vi } from "vitest";
import type { PublicSponsor } from "../../assets/shared/schemas/public-sponsors";
import {
  loadProgressiveSponsorPages,
  sponsorWeightClass,
  sponsorWeightsDescending,
} from "../../assets/ts/member-flows/sponsors-wall";

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

describe("progressive sponsor pagination", () => {
  it("renders every sponsor beyond row 200 while preserving server filters and sort", async () => {
    const records = Array.from({ length: 201 }, (_, index) => ({
      ...sponsor(8),
      id: index.toString(16).padStart(32, "0"),
      name: `Sponsor ${index}`,
    }));
    const requests: URL[] = [];
    const publishedSizes: number[] = [];
    const controller = new AbortController();

    const result = await loadProgressiveSponsorPages({
      endpoint: "/api/v1/sponsors",
      query: new URLSearchParams({ eventName: "Amsterdam 2026", level: "Gold", minWeight: "5", sort: "-weight" }),
      signal: controller.signal,
      load: async (url) => {
        const request = new URL(url, "https://pkic.org");
        requests.push(request);
        const limit = Number(request.searchParams.get("limit"));
        const offset = Number(request.searchParams.get("offset"));
        const page = records.slice(offset, offset + limit);
        return {
          sponsors: page,
          page: { limit, offset, total: records.length, hasMore: offset + page.length < records.length },
        };
      },
      onPage: (items) => publishedSizes.push(items.length),
    });

    expect(result).toHaveLength(201);
    expect(publishedSizes).toEqual([100, 200, 201]);
    expect(requests.map((request) => request.searchParams.get("offset"))).toEqual(["0", "100", "200"]);
    expect(requests.every((request) => request.searchParams.get("eventName") === "Amsterdam 2026")).toBe(true);
    expect(requests.every((request) => request.searchParams.get("level") === "Gold")).toBe(true);
    expect(requests.every((request) => request.searchParams.get("minWeight") === "5")).toBe(true);
    expect(requests.every((request) => request.searchParams.get("sort") === "-weight")).toBe(true);
  });

  it("stops at an intentional strip limit instead of silently treating it as a complete catalogue", async () => {
    const records = Array.from({ length: 150 }, (_, index) => ({
      ...sponsor(8),
      id: index.toString(16).padStart(32, "0"),
    }));
    const controller = new AbortController();
    let calls = 0;
    const result = await loadProgressiveSponsorPages({
      endpoint: "/api/v1/sponsors",
      query: new URLSearchParams({ sort: "-weight" }),
      maxItems: 12,
      signal: controller.signal,
      load: async (url) => {
        calls += 1;
        const request = new URL(url, "https://pkic.org");
        const limit = Number(request.searchParams.get("limit"));
        return {
          sponsors: records.slice(0, limit),
          page: { limit, offset: 0, total: records.length, hasMore: true },
        };
      },
      onPage: () => {},
    });

    expect(result).toHaveLength(12);
    expect(calls).toBe(1);
  });

  it("treats an explicit zero limit as an empty result without making a request", async () => {
    const controller = new AbortController();
    const onPage = vi.fn();
    const load = vi.fn();
    const result = await loadProgressiveSponsorPages({
      endpoint: "/api/v1/sponsors",
      query: new URLSearchParams(),
      maxItems: 0,
      signal: controller.signal,
      load,
      onPage,
    });

    expect(result).toEqual([]);
    expect(load).not.toHaveBeenCalled();
    expect(onPage).toHaveBeenCalledWith([]);
  });

  it("rejects invalid item limits instead of issuing an unbounded or malformed request", async () => {
    const controller = new AbortController();
    await expect(
      loadProgressiveSponsorPages({
        endpoint: "/api/v1/sponsors",
        query: new URLSearchParams(),
        maxItems: Number.NaN,
        signal: controller.signal,
        load: async () => ({ sponsors: [], page: { limit: 1, offset: 0, total: 0, hasMore: false } }),
        onPage: () => {},
      }),
    ).rejects.toThrow("non-negative safe integer");
  });
});
