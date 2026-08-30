// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberVote } from "../../assets/ts/member-flows/portal/types";
import { VoteDetails } from "../../assets/ts/member-flows/portal/sections/Votes/VoteDetails";

const mounted: HTMLElement[] = [];

function multiMemberVote(): MemberVote {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "member-motion",
    title: "Member motion",
    description: "Each represented organization has its own ballot.",
    voteType: "motion",
    ownerGroupId: "00000000-0000-4000-8000-000000000002",
    ownerGroupName: "Policy Group",
    electorateMode: "per_member",
    thresholdType: "simple_majority",
    questionFormId: null,
    quorumPercent: null,
    tieBreakMode: "none" as const,
    excludedMemberIds: null,
    eligibleCategories: null,
    opensAt: "2026-08-24T00:00:00.000Z",
    closesAt: "2026-08-26T00:00:00.000Z",
    currentRound: 1,
    status: "open",
    cancellationReason: null,
    visibility: "private",
    publicDetailLevel: "outcome_only",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    candidates: null,
    canCastBallot: true,
    hasCastBallot: true,
    memberBallots: [
      {
        memberId: "00000000-0000-4000-8000-000000000010",
        organizationName: "Organization A",
        hasCastBallot: true,
      },
      {
        memberId: "00000000-0000-4000-8000-000000000020",
        organizationName: "Organization B",
        hasCastBallot: false,
      },
    ],
    result: null,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("group-scoped per-Member ballots", () => {
  it("renders and submits a separate ballot for each represented organization", async () => {
    const requests: Array<{ url: URL; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url, location.origin),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const onChanged = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);

    await act(() =>
      render(
        <VoteDetails
          vote={multiMemberVote()}
          ballotEndpoint="/api/v1/groups/00000000-0000-4000-8000-000000000002/votes/00000000-0000-4000-8000-000000000001/ballots"
          onChanged={onChanged}
        />,
        container,
      ),
    );

    expect(container.textContent).toContain("Organization A");
    expect(container.textContent).toContain("Organization B");
    expect(container.textContent).toContain("Ballot recorded");
    expect(container.textContent).toContain("Not yet voted");

    const organizationCards = Array.from(container.querySelectorAll(".border.rounded.p-3"));
    const secondInFavor = Array.from(organizationCards[1]!.querySelectorAll("button")).find(
      (button) => button.textContent === "In favor",
    );
    await act(() => (secondInFavor as HTMLButtonElement).click());
    await settle();

    expect(requests).toEqual([
      {
        url: new URL(
          "/api/v1/groups/00000000-0000-4000-8000-000000000002/votes/00000000-0000-4000-8000-000000000001/ballots",
          location.origin,
        ),
        body: {
          choice: "in_favor",
          memberId: "00000000-0000-4000-8000-000000000020",
        },
      },
    ]);
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
