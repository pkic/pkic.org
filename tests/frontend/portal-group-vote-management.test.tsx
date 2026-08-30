// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupVoteDetail } from "../../assets/shared/schemas/group-votes";
import { GroupVoteCreateForm } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteCreateForm";
import { GroupVoteManagementControls } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteManagementControls";
import { GroupVoteProposals } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteProposals";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const VOTE_ID = "b0000000-0000-4000-8000-000000000001";
const PROPOSAL_ID = "d0000000-0000-4000-8000-000000000001";

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
    quorumPercent: null,
    tieBreakMode: "none" as const,
    excludedMemberIds: null,
    eligibleCategories: null,
    opensAt: "2026-08-01T00:00:00.000Z",
    closesAt: "2026-09-01T00:00:00.000Z",
    currentRound: 1,
    status: "open" as const,
    cancellationReason: null,
    visibility: "private" as const,
    publicDetailLevel: "outcome_only" as const,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function managedVote(): GroupVoteDetail {
  return {
    ...voteSummary(),
    candidates: null,
    canCastBallot: false,
    hasCastBallot: false,
    memberBallots: [],
    result: null,
    capabilities: ["view", "manage"],
    availableTransitions: [],
  };
}

function proposal(capabilities: string[]) {
  return {
    id: PROPOSAL_ID,
    title: "Architecture proposal",
    description: "Adopt the architecture.",
    voteType: "motion",
    ownerGroupId: GROUP_ID,
    ownerGroupName: "Architecture Committee",
    proposedByUserId: "e0000000-0000-4000-8000-000000000001",
    eligibleCategories: null,
    proposedOpensAt: null,
    proposedClosesAt: null,
    status: "open_for_endorsement",
    voteId: null,
    rejectionReason: null,
    endorsementCount: 1,
    minEndorsersRequired: 2,
    createdAt: "2026-08-01T00:00:00.000Z",
    capabilities,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("selected-group vote management", () => {
  it("creates a path-owned vote without accepting an owner override", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
        return Response.json({ vote: voteSummary() });
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupVoteCreateForm groupId={GROUP_ID} onCreated={async () => {}} />, container));
    await act(() => {
      setValue(container.querySelector("#group-vote-title") as HTMLInputElement, "Architecture motion");
      setValue(container.querySelector("#group-vote-closes") as HTMLInputElement, "2026-09-01T12:00");
    });
    await act(() => (container.querySelector("button[type='submit']") as HTMLButtonElement).click());
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe(`/api/v1/groups/${GROUP_ID}/votes`);
    expect(requests[0]?.body).toMatchObject({ title: "Architecture motion", voteType: "motion" });
    expect(requests[0]?.body).not.toHaveProperty("ownerGroupId");
  });

  it("updates visibility through the selected group contract", async () => {
    const requests: Array<{ path: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({ path: url.pathname, method: init.method ?? "GET", body: JSON.parse(String(init.body)) });
        return Response.json({ vote: { ...voteSummary(), visibility: "public", publicDetailLevel: "aggregate" } });
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
    const selects = container.querySelectorAll("select");
    await act(() => {
      (selects[0] as HTMLSelectElement).value = "public";
      selects[0]?.dispatchEvent(new Event("change", { bubbles: true }));
      (selects[1] as HTMLSelectElement).value = "aggregate";
      selects[1]?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Save visibility",
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();

    expect(requests).toContainEqual({
      path: `/api/v1/groups/${GROUP_ID}/votes/${VOTE_ID}/visibility`,
      method: "PATCH",
      body: { visibility: "public", publicDetailLevel: "aggregate" },
    });
  });

  it("submits proposals directly in the selected group", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        requests.push({ path: url.pathname, method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
        return method === "POST"
          ? Response.json({ proposal: proposal(["view", "withdraw"]) })
          : Response.json({ proposals: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupVoteProposals groupId={GROUP_ID} canParticipate />, container));
    await settle();
    await act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Propose a vote",
        ) as HTMLButtonElement
      ).click(),
    );
    await act(() => {
      setValue(container.querySelector("#group-vote-proposal-title") as HTMLInputElement, "Architecture proposal");
      setValue(
        container.querySelector("#group-vote-proposal-description") as HTMLTextAreaElement,
        "Adopt the architecture.",
      );
    });
    await act(() => (container.querySelector("form button[type='submit']") as HTMLButtonElement).click());
    await settle();

    const submission = requests.find((request) => request.method === "POST");
    expect(submission).toMatchObject({
      path: `/api/v1/groups/${GROUP_ID}/vote-proposals`,
      body: { title: "Architecture proposal", description: "Adopt the architecture.", voteType: "motion" },
    });
    expect(submission?.body).not.toHaveProperty("ownerGroupId");
  });

  it("shows only server-authorized proposal actions and approves through the group", async () => {
    const requests: Array<{ path: string; method: string }> = [];
    const managedProposal = proposal(["view", "approve", "reject"]);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        requests.push({ path: url.pathname, method });
        if (method === "POST") return Response.json({ proposal: managedProposal, convertedVote: voteSummary() });
        if (url.pathname.endsWith(`/${PROPOSAL_ID}`))
          return Response.json({ proposal: managedProposal, endorserUserIds: [] });
        return Response.json({
          proposals: [managedProposal],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupVoteProposals groupId={GROUP_ID} canParticipate={false} />, container));
    await settle();
    await act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Details",
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Endorse")).toBe(
      false,
    );
    await act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Approve and create vote",
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();

    expect(requests).toContainEqual({
      path: `/api/v1/groups/${GROUP_ID}/vote-proposals/${PROPOSAL_ID}/approve`,
      method: "POST",
    });
  });
});
