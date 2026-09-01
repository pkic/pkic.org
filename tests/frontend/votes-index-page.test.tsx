// @vitest-environment jsdom
/**
 * The public votes index: the two bounded section queries it builds, and what
 * the rendered listing exposes to someone who is not looking at it — the
 * status of each vote in words as well as a tone, a named link over each card,
 * and a designed empty state rather than a blank grid.
 *
 * Fixtures are parsed through `publicVotesListResponseSchema` on the way out,
 * because that is what `getJson` parses on the way in.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VotesIndex, buildVotesSectionUrl, mergeVotesSection } from "../../assets/ts/member-flows/votes-index-page";
import { publicVotesListResponseSchema } from "../../assets/shared/schemas/votes";

const mounted: HTMLElement[] = [];

type VotePayload = Record<string, unknown>;

function vote(overrides: VotePayload = {}): VotePayload {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    slug: "charter-amendment",
    title: "Charter amendment",
    description: "Adopt the revised charter.",
    voteType: "motion",
    ownerGroupId: "20000000-0000-4000-8000-000000000001",
    ownerGroupName: "Post-Quantum Cryptography",
    electorateMode: "per_member",
    thresholdType: "simple_majority",
    questionFormId: null,
    quorumPercent: null,
    tieBreakMode: "none",
    excludedMemberIds: null,
    eligibleCategories: null,
    opensAt: "2026-09-01T00:00:00.000Z",
    closesAt: "2026-09-30T00:00:00.000Z",
    currentRound: 1,
    status: "open",
    cancellationReason: null,
    visibility: "public",
    publicDetailLevel: "outcome_only",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    candidates: null,
    result: null,
    ...overrides,
  };
}

/** One section's page, as the endpoint would send it, contract-checked here. */
function sectionResponse(votes: VotePayload[], hasMore = false): string {
  return JSON.stringify(
    publicVotesListResponseSchema.parse({
      votes,
      page: { limit: 20, offset: 0, total: votes.length, hasMore },
    }),
  );
}

/** Routes each section's request to its own body, keyed by the status filter. */
function stubSections(bodies: { open: string; closed: string }, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    const body = url.includes("status=closed") ? bodies.closed : bodies.open;
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mountIndex(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() => {
    render(<VotesIndex apiBase="/api/v1" detailBase="/votes/detail/" />, container);
  });
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

describe("public votes index", () => {
  it("states each vote's status in words beside the tone, not by color alone", async () => {
    stubSections({ open: sectionResponse([vote()]), closed: sectionResponse([]) });

    const container = await mountIndex();

    const badges = [...container.querySelectorAll(".pk-badge")].map((badge) => badge.textContent);
    expect(badges).toContain("Open");
    expect(badges).toContain("Motion");
    expect(badges).toContain("Post-Quantum Cryptography");
  });

  it("makes each card's whole area one named link rather than a click handler", async () => {
    stubSections({ open: sectionResponse([vote()]), closed: sectionResponse([]) });

    const container = await mountIndex();

    const link = container.querySelector<HTMLAnchorElement>("a.pk-stretched");
    expect(link?.getAttribute("aria-label")).toBe("Charter amendment");
    expect(link?.getAttribute("href")).toBe("/votes/detail/?slug=charter-amendment");
    // Nothing is activated by a handler on a non-interactive element.
    expect(container.querySelector(".member-card[onclick]")).toBeNull();
  });

  it("names the load-more control after the section it extends", async () => {
    stubSections({ open: sectionResponse([vote()], true), closed: sectionResponse([]) });

    const container = await mountIndex();

    const labels = [...container.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toContain("Load more open for voting");
  });

  it("announces an empty index as a status region instead of leaving the page blank", async () => {
    stubSections({ open: sectionResponse([]), closed: sectionResponse([]) });

    const container = await mountIndex();

    const status = container.querySelector('[role="status"].pk-empty-state');
    expect(status?.textContent).toContain("No public votes yet.");
  });

  it("states a failed listing as a sentence in an alert, not as a status code", async () => {
    stubSections({ open: "{}", closed: "{}" }, 503);

    const container = await mountIndex();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("The service is temporarily unavailable.");
    expect(alert?.textContent).not.toContain("HTTP 503");
  });
});
