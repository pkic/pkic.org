// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupVotes } from "../../assets/ts/member-flows/portal/sections/management/GroupVotes";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const VOTE_ID = "b0000000-0000-4000-8000-000000000001";

function voteSummary() {
  return {
    id: VOTE_ID,
    slug: "architecture-motion",
    title: "Architecture motion",
    description: "Adopt the architecture.",
    voteType: "motion" as const,
    ownerGroupId: GROUP_ID,
    ownerGroupName: "Architecture Committee",
    electorateMode: "per_member" as const,
    thresholdType: "simple_majority" as const,
    eligibleCategories: null,
    opensAt: "2026-08-01T00:00:00.000Z",
    closesAt: "2026-09-01T00:00:00.000Z",
    currentRound: 1,
    status: "open" as const,
    visibility: "private" as const,
    publicDetailLevel: "outcome_only" as const,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("selected-group vote participation", () => {
  it("loads detail and submits each organization ballot through the selected group", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        requests.push({
          path: url.pathname,
          method,
          ...(typeof init.body === "string" ? { body: JSON.parse(init.body) } : {}),
        });
        const vote = voteSummary();
        if (method === "POST") return Response.json({ success: true });
        if (url.pathname.endsWith(`/${VOTE_ID}`)) {
          return Response.json({
            vote: {
              ...vote,
              candidates: null,
              canCastBallot: true,
              hasCastBallot: false,
              memberBallots: [
                {
                  memberId: "c0000000-0000-4000-8000-000000000001",
                  organizationName: "Example Organization",
                  hasCastBallot: false,
                },
              ],
              result: null,
              capabilities: ["view", "participate", "view_results"],
            },
          });
        }
        return Response.json({
          votes: [{ ...vote, capabilities: ["view", "participate", "view_results"] }],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupVotes groupId={GROUP_ID} />, container));
    await settle();

    const details = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Details");
    await act(() => (details as HTMLButtonElement).click());
    await settle();
    expect(container.textContent).toContain("Example Organization");

    const inFavor = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "In favor",
    );
    await act(() => (inFavor as HTMLButtonElement).click());
    await settle();

    expect(requests).toContainEqual({
      path: `/api/v1/groups/${GROUP_ID}/votes/${VOTE_ID}/ballots`,
      method: "POST",
      body: { choice: "in_favor", memberId: "c0000000-0000-4000-8000-000000000001" },
    });
  });
});
