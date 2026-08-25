// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposalsTab } from "../../assets/ts/admin/sections/Votes/ProposalsTab";

vi.mock("../../assets/ts/admin/sections/Votes/ProposalDetail", () => ({
  ProposalDetail: ({ proposalId }: { proposalId: string }) => <div data-proposal-detail>{proposalId}</div>,
}));

let mounted: HTMLElement | null = null;

function proposal(index: number, status: "open_for_endorsement" | "converted_to_vote", title?: string) {
  const suffix = index.toString(16).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    title: title ?? `Proposal ${index}`,
    description: "A proposal with a paginated admin read model.",
    voteType: "motion" as const,
    ownerGroupId: "20000000-0000-4000-8000-000000000001",
    ownerGroupName: "All Members",
    proposedByUserId: `10000000-0000-4000-8000-${suffix}`,
    status,
    voteId: status === "converted_to_vote" ? `20000000-0000-4000-8000-${suffix}` : null,
    rejectionReason: null,
    endorsementCount: 1,
    minEndorsersRequired: 2,
    createdAt: "2026-08-23T00:00:00.000Z",
  };
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  if (mounted) {
    void act(() => render(null, mounted!));
    mounted.remove();
    mounted = null;
  }
  vi.unstubAllGlobals();
});

describe("admin vote proposal pagination", () => {
  it("reaches page two, resets filters to page one, and ignores the stale page response", async () => {
    const requests: URL[] = [];
    let resolveStalePage!: (value: Response) => void;
    const stalePage = new Promise<Response>((resolve) => {
      resolveStalePage = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        const status = url.searchParams.get("status");
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (status === "open_for_endorsement" && offset === 50) return stalePage;
        if (status === "converted_to_vote") {
          return Promise.resolve(
            response({
              proposals: [proposal(60, "converted_to_vote", "Converted current proposal")],
              page: { limit: 50, offset: 0, total: 1, hasMore: false },
            }),
          );
        }
        return Promise.resolve(
          response({
            proposals: Array.from({ length: 50 }, (_, index) => proposal(index + 1, "open_for_endorsement")),
            page: { limit: 50, offset: 0, total: 51, hasMore: true },
          }),
        );
      }),
    );

    mounted = document.createElement("div");
    document.body.append(mounted);
    await act(() => render(<ProposalsTab />, mounted!));
    await settle();

    expect(requests[0]?.searchParams.get("limit")).toBe("50");
    expect(requests[0]?.searchParams.get("offset")).toBe("0");
    expect(mounted.textContent).toContain("Proposal 50");

    const next = mounted.querySelector(".pagination .page-item:last-child button") as HTMLButtonElement;
    await act(() => next.click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("50");

    const convertedTab = Array.from(mounted.querySelectorAll<HTMLButtonElement>(".nav-tabs button")).find((button) =>
      button.textContent?.includes("converted to vote"),
    );
    expect(convertedTab).toBeInstanceOf(HTMLButtonElement);
    await act(() => convertedTab!.click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("status")).toBe("converted_to_vote");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(mounted.textContent).toContain("Converted current proposal");

    resolveStalePage(
      response({
        proposals: [proposal(51, "open_for_endorsement", "Stale proposal page")],
        page: { limit: 50, offset: 50, total: 51, hasMore: false },
      }),
    );
    await settle();
    expect(mounted.textContent).toContain("Converted current proposal");
    expect(mounted.textContent).not.toContain("Stale proposal page");
  });
});
