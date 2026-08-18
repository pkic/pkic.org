// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildVotesSectionUrl, mergeVotesSection } from "../../assets/ts/member-flows/votes-index-page";

describe("votes-index-page pagination helpers", () => {
  it("builds a bounded, status-filtered URL for the open section (open+scheduled)", () => {
    const url = buildVotesSectionUrl("/api/v1", "open", 0);
    expect(url).toBe("/api/v1/votes?status=open,scheduled&limit=20&offset=0&sort=closes_at");
  });

  it("builds a bounded, status-filtered URL for the closed section", () => {
    const url = buildVotesSectionUrl("/api/v1", "closed", 40);
    expect(url).toBe("/api/v1/votes?status=closed&limit=20&offset=40&sort=closes_at");
  });

  it("appends the next page onto the current section instead of replacing it", () => {
    const current = {
      votes: [{ id: "a" }, { id: "b" }] as unknown as Parameters<typeof mergeVotesSection>[0]["votes"],
      page: { limit: 20, offset: 0, total: 3, hasMore: true },
    };
    const next = {
      votes: [{ id: "c" }] as unknown as Parameters<typeof mergeVotesSection>[1]["votes"],
      page: { limit: 20, offset: 2, total: 3, hasMore: false },
    };

    const merged = mergeVotesSection(current, next);

    expect(merged.votes.map((v) => (v as unknown as { id: string }).id)).toEqual(["a", "b", "c"]);
    expect(merged.page).toEqual(next.page);
    expect(merged.page.hasMore).toBe(false);
  });
});
