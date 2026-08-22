// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminVoteSummary } from "../../assets/shared/schemas/votes-admin";
import { VoteDetail } from "../../assets/ts/admin/sections/Votes/VoteDetail";

const mounted: HTMLElement[] = [];

function voteSummary(): AdminVoteSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "bounded-ballot-audit",
    title: "Bounded ballot audit",
    description: null,
    voteType: "motion",
    scopeType: "forum",
    scopeId: null,
    thresholdType: "simple_majority",
    eligibleCategories: null,
    opensAt: "2026-08-22T00:00:00.000Z",
    closesAt: "2026-08-23T00:00:00.000Z",
    currentRound: 1,
    status: "open",
    visibility: "private",
    publicDetailLevel: "outcome_only",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    candidates: null,
  };
}

function ballotResponse(offset: number) {
  const firstPage = offset === 0;
  return {
    ballots: [
      {
        id: firstPage ? "00000000-0000-4000-8000-000000000010" : "00000000-0000-4000-8000-000000000011",
        userId: firstPage ? "00000000-0000-4000-8000-000000000020" : "00000000-0000-4000-8000-000000000021",
        organizationId: null,
        choice: firstPage ? "in_favor" : "opposed",
        round: firstPage ? 1 : 2,
        submittedAt: firstPage ? "2026-08-22T00:00:00.000Z" : "2026-08-22T00:01:00.000Z",
      },
    ],
    page: { limit: 50, offset, total: 51, hasMore: firstPage },
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
});

describe("admin vote ballot audit", () => {
  it("loads only on demand and pages through the shared server collection", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input : input.url,
          location.origin,
        );
        requests.push(url);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        return new Response(JSON.stringify(ballotResponse(offset)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() => render(<VoteDetail vote={voteSummary()} onChanged={() => undefined} />, container));

    expect(requests).toHaveLength(0);
    const load = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Load ballots",
    );
    expect(load).toBeInstanceOf(HTMLButtonElement);
    await act(() => (load as HTMLButtonElement).click());
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/api/v1/admin/votes/00000000-0000-4000-8000-000000000001/ballots");
    expect(requests[0]?.searchParams.get("limit")).toBe("50");
    expect(requests[0]?.searchParams.get("offset")).toBe("0");
    expect(container.textContent).toContain("in_favor");
    expect(container.textContent).not.toContain("opposed");

    const next = container.querySelector(".adm-pager .page-item:last-child button");
    expect(next).toBeInstanceOf(HTMLButtonElement);
    await act(() => (next as HTMLButtonElement).click());
    await settle();

    expect(requests).toHaveLength(2);
    expect(requests[1]?.searchParams.get("offset")).toBe("50");
    expect(container.textContent).toContain("opposed");
    expect(container.textContent).not.toContain("in_favor");
  });
});
