// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupVotes } from "../../assets/ts/member-flows/portal/sections/management/GroupVotes";
import { openConfirmation } from "./helpers/confirm-dialog";

// The votes surface routes creation through the portal's hash location, so the
// component needs one even when a test only exercises participation.
const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));

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
              availableTransitions: [],
            },
          });
        }
        return Response.json({
          votes: [{ ...vote, capabilities: ["view", "participate", "view_results"], availableTransitions: [] }],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(<GroupVotes groupId={GROUP_ID} canManage={false} canParticipate voteSegment={VOTE_ID} />, container),
    );
    await settle();
    expect(container.textContent).toContain("Example Organization");
    expect(requests).toContainEqual({
      path: `/api/v1/groups/${GROUP_ID}/votes/${VOTE_ID}`,
      method: "GET",
    });

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

  it("closes a managed vote through the selected group and reloads its state", async () => {
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
        if (method === "POST") return Response.json({ vote: { ...vote, status: "closed" }, outcome: "closed" });
        if (url.pathname.endsWith(`/${VOTE_ID}`)) {
          return Response.json({
            vote: {
              ...vote,
              candidates: null,
              canCastBallot: false,
              hasCastBallot: false,
              memberBallots: [],
              result: null,
              capabilities: ["view", "manage"],
              availableTransitions: ["close", "cancel"],
            },
          });
        }
        return Response.json({
          votes: [{ ...vote, capabilities: ["view", "manage"], availableTransitions: ["close", "cancel"] }],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <>
          <GroupVotes groupId={GROUP_ID} canManage canParticipate />
          <ConfirmDialogHost />
        </>,
        container,
      ),
    );
    await settle();
    await act(() =>
      (
        Array.from(container.querySelectorAll("button.pk-table__row-link")).find(
          (button) => button.textContent === "Show details for Architecture motion",
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();
    await act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Close current round",
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();
    const closeDialog = openConfirmation(container);
    expect(closeDialog).not.toBeNull();
    await act(() =>
      (
        Array.from(closeDialog?.querySelectorAll("button") ?? []).find((button) =>
          button.textContent?.startsWith("Close"),
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();

    expect(requests).toContainEqual({
      path: `/api/v1/groups/${GROUP_ID}/votes/${VOTE_ID}/transitions`,
      method: "POST",
      body: { transition: "close" },
    });
    expect(requests.filter((request) => request.path.endsWith(`/${VOTE_ID}`) && request.method === "GET")).toHaveLength(
      2,
    );
  });

  it("requires and submits a reason when cancelling a managed vote", async () => {
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
        if (method === "POST") {
          return Response.json({
            vote: { ...vote, status: "cancelled", cancellationReason: "No quorum" },
            outcome: "cancelled",
          });
        }
        if (url.pathname.endsWith(`/${VOTE_ID}`)) {
          return Response.json({
            vote: {
              ...vote,
              candidates: null,
              canCastBallot: false,
              hasCastBallot: false,
              memberBallots: [],
              result: null,
              capabilities: ["view", "manage"],
              availableTransitions: ["cancel"],
            },
          });
        }
        return Response.json({
          votes: [{ ...vote, capabilities: ["view", "manage"], availableTransitions: ["cancel"] }],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupVotes groupId={GROUP_ID} canManage canParticipate />, container));
    await settle();
    await act(() =>
      (
        Array.from(container.querySelectorAll("button.pk-table__row-link")).find(
          (button) => button.textContent === "Show details for Architecture motion",
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();
    await act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Cancel vote",
        ) as HTMLButtonElement
      ).click(),
    );
    const reason = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(() => {
      reason.value = "No quorum";
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Confirm cancellation",
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();

    expect(requests).toContainEqual({
      path: `/api/v1/groups/${GROUP_ID}/votes/${VOTE_ID}/transitions`,
      method: "POST",
      body: { transition: "cancel", reason: "No quorum" },
    });
  });
});
