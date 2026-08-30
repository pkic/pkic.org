// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupVoteManagementControls } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteManagementControls";
import type { GroupVoteDetail } from "../../assets/shared/schemas/group-votes";
import { GroupVoteStatistics } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteStatistics";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const VOTE_ID = "b0000000-0000-4000-8000-000000000001";

function managedVote(): GroupVoteDetail {
  return {
    id: VOTE_ID,
    slug: "architecture-motion",
    title: "Architecture motion",
    description: "Adopt the architecture.",
    voteType: "motion",
    ownerGroupId: GROUP_ID,
    ownerGroupName: "Architecture Committee",
    electorateMode: "per_member",
    thresholdType: "simple_majority",
    quorumPercent: null,
    tieBreakMode: "none" as const,
    excludedMemberIds: null,
    eligibleCategories: null,
    opensAt: "2026-08-01T00:00:00.000Z",
    closesAt: "2026-09-01T00:00:00.000Z",
    currentRound: 1,
    status: "open",
    cancellationReason: null,
    visibility: "private",
    publicDetailLevel: "outcome_only",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    candidates: null,
    canCastBallot: false,
    hasCastBallot: false,
    memberBallots: [],
    result: null,
    capabilities: ["view", "manage"],
    availableTransitions: [],
  };
}

function statistics(overrides: Record<string, unknown> = {}) {
  return {
    voteId: VOTE_ID,
    groupId: GROUP_ID,
    round: 1,
    status: "closed",
    electorateMode: "per_member",
    participation: {
      unit: "member",
      currentEligible: 8,
      currentEligibleCast: 5,
      currentEligibleNotCast: 3,
      effectiveBallots: 6,
      ballotsWithoutCurrentEligibility: 1,
    },
    aggregate: {
      availability: "available",
      kind: "motion",
      counts: { in_favor: 4, opposed: 1, abstain: 1 },
    },
    ...overrides,
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

describe("group vote statistics", () => {
  it("renders server-provided participation and motion aggregates without client-side computation", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        return Response.json(statistics());
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);

    await act(() => render(<GroupVoteStatistics groupId={GROUP_ID} voteId={VOTE_ID} />, container));
    await settle();

    expect(requests).toEqual([`/api/v1/groups/${GROUP_ID}/votes/${VOTE_ID}/statistics`]);
    expect(container.textContent).toContain("Currently eligible8");
    expect(container.textContent).toContain("Currently eligible and not cast3");
    expect(container.textContent).toContain("Ballots without current eligibility: 1");
    expect(container.textContent).toContain("in favor");
    expect(container.textContent).toContain("4");
  });

  it("renders withheld and election aggregates from their discriminated server responses", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const fetchMock = vi.fn(async () =>
      Response.json(
        statistics({
          status: "open",
          aggregate: { availability: "withheld_until_closed" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(() => render(<GroupVoteStatistics groupId={GROUP_ID} voteId={VOTE_ID} />, container));
    await settle();
    expect(container.textContent).toContain("Aggregate results will be available after the vote closes.");

    document.body.replaceChildren();
    const electionContainer = document.createElement("div");
    document.body.append(electionContainer);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          statistics({
            electorateMode: "per_person",
            aggregate: {
              availability: "available",
              kind: "election",
              candidates: [{ candidateId: "c0000000-0000-4000-8000-000000000001", candidateName: "Ada", count: 4 }],
            },
          }),
        ),
      ),
    );
    await act(() => render(<GroupVoteStatistics groupId={GROUP_ID} voteId={VOTE_ID} />, electionContainer));
    await settle();
    expect(electionContainer.textContent).toContain("Election candidates");
    expect(electionContainer.textContent).toContain("Ada");
    expect(electionContainer.textContent).toContain("4");
  });

  it("does not request statistics until a manager explicitly expands the control", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requests.push(`${init.method ?? "GET"} ${url}`);
        if (url.endsWith("/statistics")) return Response.json(statistics());
        return Response.json({ ballots: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);

    await act(() =>
      render(
        <GroupVoteManagementControls groupId={GROUP_ID} vote={managedVote()} onChanged={async () => {}} />,
        container,
      ),
    );
    await settle();
    expect(requests.some((request) => request.endsWith("/statistics"))).toBe(false);

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Load vote statistics",
    );
    expect(button).toBeDefined();
    await act(() => (button as HTMLButtonElement).click());
    await settle();
    expect(requests).toContain(`GET /api/v1/groups/${GROUP_ID}/votes/${VOTE_ID}/statistics`);
  });
});
