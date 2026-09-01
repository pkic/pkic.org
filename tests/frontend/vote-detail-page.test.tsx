// @vitest-environment jsdom
/**
 * The public vote detail page: what it fetches, what it renders for each
 * result shape, and — the part a visual review cannot check — what the page
 * exposes to someone who is not looking at it.
 *
 * The payloads here are parsed by `publicVoteGetResponseSchema` on the way in,
 * because that is what `getJson` does: a fixture that drifts from the shared
 * contract fails here rather than passing against a shape the server never
 * sends.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoteDetailPage } from "../../assets/ts/member-flows/vote-detail-page";
import { publicVoteGetResponseSchema } from "../../assets/shared/schemas/votes";

const mounted: HTMLElement[] = [];

const CANDIDATE_ONE = "00000000-0000-4000-8000-0000000000c1";
const CANDIDATE_TWO = "00000000-0000-4000-8000-0000000000c2";

type PublicVotePayload = Record<string, unknown>;

function publicVote(overrides: PublicVotePayload = {}): PublicVotePayload {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "membership-fee-motion",
    title: "Raise the membership fee",
    description: "A motion of the Policy Group.",
    voteType: "motion",
    ownerGroupId: "00000000-0000-4000-8000-000000000002",
    ownerGroupName: "Policy Group",
    electorateMode: "per_member",
    thresholdType: "simple_majority",
    questionFormId: null,
    quorumPercent: null,
    tieBreakMode: "none",
    excludedMemberIds: null,
    eligibleCategories: null,
    opensAt: "2026-08-24T00:00:00.000Z",
    closesAt: "2026-08-26T00:00:00.000Z",
    currentRound: 1,
    status: "closed",
    cancellationReason: null,
    visibility: "public",
    publicDetailLevel: "aggregate",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    candidates: null,
    result: null,
    ...overrides,
  };
}

/** The fixture as the endpoint would send it, contract-checked on the way out. */
function voteResponse(overrides: PublicVotePayload = {}): string {
  return JSON.stringify(publicVoteGetResponseSchema.parse({ vote: publicVote(overrides) }));
}

function stubFetch(body: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mount(indexHref = "/votes/"): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() => {
    render(<VoteDetailPage apiBase="/api/v1" indexHref={indexHref} />, container);
  });
  // The fetch is started in an effect, so let its microtasks drain.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  window.history.replaceState({}, "", "/votes/detail/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public vote detail page", () => {
  it("fetches the vote named by ?slug= and renders its heading and metadata", async () => {
    window.history.replaceState({}, "", "/votes/detail/?slug=membership-fee-motion");
    const fetchMock = stubFetch(voteResponse());

    const container = await mount();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/v1/votes/membership-fee-motion");

    // The title is the page's only h1, so the document has one top-level name.
    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("Raise the membership fee");

    // Each metadata badge carries a hidden term, so "Policy Group" and
    // "Per Member" are not three unexplained words in a row to a reader who
    // never sees the layout.
    const hiddenTerms = Array.from(container.querySelectorAll(".pk-sr-only")).map((el) => el.textContent);
    expect(hiddenTerms).toEqual(["Vote type: ", "Held by: ", "Electorate: "]);
    expect(container.textContent).toContain("Policy Group");
    expect(container.textContent).toContain("Per Member");
  });

  it("announces the wait, by name, before the vote arrives", async () => {
    window.history.replaceState({}, "", "/votes/detail/?slug=membership-fee-motion");
    // Never resolves, so the loading state is what stays on screen.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() => {
      render(<VoteDetailPage apiBase="/api/v1" indexHref="/votes/" />, container);
    });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("Loading vote…");
  });

  it("names a decided motion with the product's own word for it, not just a colour", async () => {
    window.history.replaceState({}, "", "/votes/detail/?slug=membership-fee-motion");
    stubFetch(
      voteResponse({
        result: {
          thresholdType: "simple_majority",
          counts: { in_favor: 12, opposed: 3, abstain: 1 },
          totalBallots: 16,
          outcome: "passed",
        },
      }),
    );

    const container = await mount();

    // The only badge on the page carrying a tone dot: the three metadata
    // badges above it are facts, not statuses, and render without one.
    const badge = container.querySelector(".pk-badge--dot");
    expect(badge?.textContent).toBe("Passed");
    // The tone is repeated as a dot rather than resting on the fill colour.
    expect(badge?.className).toContain("pk-badge--ok");
    expect(badge?.className).toContain("pk-badge--dot");
    expect(container.textContent).toContain("12 in favor · 3 opposed · 1 abstained");
    expect(container.textContent).toContain("(16 ballots cast)");
  });

  it("says a motion was not decided rather than calling low turnout a defeat", async () => {
    window.history.replaceState({}, "", "/votes/detail/?slug=membership-fee-motion");
    stubFetch(
      voteResponse({
        result: {
          thresholdType: "simple_majority",
          counts: { in_favor: 2, opposed: 1, abstain: 0 },
          totalBallots: 3,
          outcome: "not_quorate",
        },
      }),
    );

    const container = await mount();

    expect(container.querySelector(".pk-badge--dot")?.textContent).toBe("Not decided — turnout too low");
    expect(container.textContent).not.toContain("Failed");
  });

  it("names the winner and every round of an election", async () => {
    window.history.replaceState({}, "", "/votes/detail/?slug=board-election");
    stubFetch(
      voteResponse({
        voteType: "election",
        candidates: [
          {
            id: CANDIDATE_ONE,
            userId: null,
            candidateName: "Ada Lovelace",
            candidateBio: null,
            sortOrder: 1,
            eliminatedRound: null,
          },
          {
            id: CANDIDATE_TWO,
            userId: null,
            candidateName: "Grace Hopper",
            candidateBio: null,
            sortOrder: 2,
            eliminatedRound: 1,
          },
        ],
        result: {
          rounds: [
            {
              round: 1,
              counts: { [CANDIDATE_ONE]: 9, [CANDIDATE_TWO]: 4 },
              eliminatedCandidateIds: [CANDIDATE_TWO],
              winnerCandidateId: CANDIDATE_ONE,
            },
          ],
          winnerCandidateId: CANDIDATE_ONE,
        },
      }),
    );

    const container = await mount();

    expect(container.textContent).toContain("Elected");
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("Round 1");
    expect(container.textContent).toContain("Grace Hopper: 4 (eliminated)");
  });

  it("says results are pending for a vote that has not closed", async () => {
    window.history.replaceState({}, "", "/votes/detail/?slug=membership-fee-motion");
    stubFetch(voteResponse({ status: "open", result: null }));

    const container = await mount();

    expect(container.textContent).toContain("Results will be published here once voting closes");
  });

  it("shows the not-found panel, as a status region, when the vote does not exist", async () => {
    window.history.replaceState({}, "", "/votes/detail/?slug=no-such-vote");
    stubFetch(JSON.stringify({ error: { code: "NOT_FOUND", message: "No such vote" } }), 404);

    const container = await mount("/votes/");

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("We couldn’t find that vote.");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/votes/");
  });

  it("shows the not-found panel when the URL carries no slug at all, and never fetches", async () => {
    window.history.replaceState({}, "", "/votes/detail/");
    const fetchMock = stubFetch(voteResponse());

    const container = await mount();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("We couldn’t find that vote.");
  });

  it("turns a server failure into a sentence in an alert, not a raw status code", async () => {
    window.history.replaceState({}, "", "/votes/detail/?slug=membership-fee-motion");
    stubFetch("", 500);

    const container = await mount();

    const alert = container.querySelector(".pk-alert");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Something went wrong on our side.");
    expect(container.textContent).not.toContain("HTTP 500");
  });
});
