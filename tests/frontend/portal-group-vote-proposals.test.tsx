// @vitest-environment jsdom
/**
 * Vote proposals in a selected group: submitting one, what the server lets a
 * reader do with it, and how a refusal reads.
 *
 * Split from `portal-group-vote-management.test.tsx`, which is about the vote
 * itself. The two were one file and it outgrew the line budget, which is the
 * signal to separate a responsibility rather than to move unrelated code
 * somewhere else.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  groupVoteProposalApproveResponseSchema,
  groupVoteProposalCreateSchema,
  groupVoteProposalRejectSchema,
} from "../../assets/shared/schemas/group-vote-proposals";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupVoteProposalForm } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteProposalForm";
import {
  GroupVoteProposalRecord,
  GroupVoteProposals,
} from "../../assets/ts/member-flows/portal/sections/management/GroupVoteProposals";
import { confirmationButton, openConfirmation } from "./helpers/confirm-dialog";
import { buttonNamed, controlFor as labeledControl, markdownControl, typeMarkdown } from "./helpers/labelled-control";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const PROPOSAL_ID = "d0000000-0000-4000-8000-000000000001";
const VOTE_ID = "b0000000-0000-4000-8000-000000000001";
const LIST_PATH = `/groups/${GROUP_ID}/votes/proposals`;
const recordPath = (proposalId: string) => `${LIST_PATH}/${proposalId}`;

/** The proposal's own page (#126), mounted the way the votes section mounts it. */
function record() {
  return <GroupVoteProposalRecord groupId={GROUP_ID} proposalId={PROPOSAL_ID} listPath={LIST_PATH} />;
}

/** The vote an approved proposal becomes; only its identity matters here. */
function convertedVote() {
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
    questionFormId: null,
    questionForm: null,
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

/** See the note on the same helper in `portal-group-vote-management.test.tsx`. */
function namedRegion(container: HTMLElement, name: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll("section[aria-labelledby], section[aria-label]")).find((section) => {
    const label = section.getAttribute("aria-label");
    if (label) return label === name;
    const target = container.querySelector(`[id="${String(section.getAttribute("aria-labelledby"))}"]`);
    return target?.textContent?.trim() === name;
  }) as HTMLElement | undefined;
}

function confirmDialogButton(label: string): HTMLButtonElement {
  if (!openConfirmation()) throw new Error("no confirm dialog is open");
  const button = confirmationButton(label);
  if (!button) throw new Error(`missing confirm dialog button: ${label}`);
  return button;
}

afterEach(() => {
  navigate.mockReset();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("selected-group vote proposals", () => {
  /*
   * #52 asked what the difference between a vote and a proposal is, having
   * found a Proposals tab that offered no way to create one. The reader was
   * managing a group they do not participate in, so the absence was correct
   * — but the page said only "No vote proposals are available through this
   * group", which reads as a feature that does not work.
   *
   * An empty state that cannot say why is the defect. This pins that it
   * explains the relationship and names what that reader can do instead.
   */
  it("explains what a proposal is, and why a non-participant cannot make one", async () => {
    const empty = () =>
      new Response(JSON.stringify({ proposals: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const container = document.createElement("div");
    document.body.append(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => empty()),
    );
    await act(async () => {
      render(
        <GroupVoteProposals groupId={GROUP_ID} canParticipate={false} onPropose={() => {}} recordPath={recordPath} />,
        container,
      );
    });
    // The table renders its head first and its empty state once the page has
    // come back, so this waits for the answer rather than for one tick.
    for (let attempt = 0; attempt < 5; attempt++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      if ((container.textContent ?? "").includes("request for a vote")) break;
    }

    const text = container.textContent ?? "";
    // What a proposal is, and how it becomes a vote.
    expect(text).toContain("participant's request for a vote");
    expect(text).toContain("endorsements");
    // Why there is no action here, and where the reader can go instead.
    expect(text).toContain("not participating in this group");
    expect(text).toContain("All votes");
    // And no command offered that this reader may not take.
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).not.toContain(
      "Propose a vote",
    );
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

    /*
     * Proposing is a page of its own now, so the list's action navigates
     * rather than unfolding a form. The list is asked for that, and the form
     * itself is mounted for what it submits.
     */
    const proposed = vi.fn();
    await act(() =>
      render(
        <GroupVoteProposals groupId={GROUP_ID} canParticipate onPropose={proposed} recordPath={recordPath} />,
        container,
      ),
    );
    await settle();
    await act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Propose a vote",
        ) as HTMLButtonElement
      ).click(),
    );
    expect(proposed).toHaveBeenCalledOnce();
    expect([...container.querySelectorAll("label")].some((label) => label.textContent?.startsWith("Title"))).toBe(
      false,
    );

    await act(() => render(<GroupVoteProposalForm groupId={GROUP_ID} onCreated={async () => {}} />, container));
    await settle();
    // Resolved through the label's `for` and the control's `id`: the form no
    // longer hand-writes ids, and the pair is what a reader actually gets.
    await act(() => {
      setValue(labeledControl(container, "Title"), "Architecture proposal");
    });
    await typeMarkdown(container, "Description", "Adopt the architecture.");
    await act(() => buttonNamed(container, "Submit proposal").click());
    await settle();

    const submission = requests.find((request) => request.method === "POST");
    expect(submission?.path).toBe(`/api/v1/groups/${GROUP_ID}/vote-proposals`);
    // Parsed through the shared request contract rather than compared to a
    // literal, so the assertion fails if the payload stops being a valid one.
    expect(groupVoteProposalCreateSchema.parse(submission?.body)).toMatchObject({
      title: "Architecture proposal",
      description: "Adopt the architecture.",
      voteType: "motion",
    });
    expect(submission?.body).not.toHaveProperty("ownerGroupId");
  });

  it("shows only server-authorized proposal actions and approves through the group", async () => {
    const requests: Array<{ path: string; method: string }> = [];
    const managedProposal = proposal(["view", "approve", "reject"]);
    groupVoteProposalApproveResponseSchema.parse({ proposal: managedProposal, convertedVote: convertedVote() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        requests.push({ path: url.pathname, method });
        if (method === "POST") return Response.json({ proposal: managedProposal, convertedVote: convertedVote() });
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
    await act(() =>
      render(
        <>
          <ConfirmDialogHost />
          {record()}
        </>,
        container,
      ),
    );
    await settle();
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
    await act(() => confirmDialogButton("Approve and create vote").click());
    await settle();

    expect(requests).toContainEqual({
      path: `/api/v1/groups/${GROUP_ID}/vote-proposals/${PROPOSAL_ID}/approve`,
      method: "POST",
    });
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent ?? "").toBe("");
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/votes/${VOTE_ID}`);
  });

  it("does not withdraw a proposal when the confirmation is cancelled", async () => {
    const requests: Array<{ path: string; method: string }> = [];
    const managedProposal = proposal(["view", "withdraw"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        requests.push({ path: url.pathname, method });
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
    await act(() =>
      render(
        <>
          <ConfirmDialogHost />
          {record()}
        </>,
        container,
      ),
    );
    await settle();
    await settle();
    await act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Withdraw proposal",
        ) as HTMLButtonElement
      ).click(),
    );
    await act(() => confirmDialogButton("Cancel").click());
    await settle();

    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("names the proposal list, and sends a row to the proposal's own page", async () => {
    const managedProposal = proposal(["view", "reject"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
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
    await act(() =>
      render(
        <GroupVoteProposals groupId={GROUP_ID} canParticipate={false} onPropose={() => {}} recordPath={recordPath} />,
        container,
      ),
    );
    await settle();

    // Four unnamed tables on a page are announced as four tables.
    expect(container.querySelector("table caption")?.textContent).toBe("Vote proposals");

    // The row is a link to the proposal's own address (#126), never an
    // expansion between the rows, and it names what it opens.
    const open = container.querySelector<HTMLAnchorElement>("a.pk-table__row-link");
    expect(open?.textContent).toBe("Open Architecture proposal");
    expect(open?.getAttribute("href")).toBe(`#${LIST_PATH}/${PROPOSAL_ID}`);
    expect(container.querySelector('[role="region"]')).toBeNull();

    // The page heads itself with the proposal, under the list's trail, and
    // its region is named after the proposal it belongs to.
    await act(() => render(record(), container));
    await settle();
    await settle();
    expect(container.querySelector("h2")?.textContent).toBe(managedProposal.title);
    expect(container.querySelector('nav[aria-label="Breadcrumb"]')?.textContent).toContain("Proposals");
    expect(namedRegion(container, managedProposal.title)).toBeTruthy();
    // The rejection reason is a required, described control, not a bare box.
    const reason = await markdownControl(container, "Rejection reason");
    expect(reason.getAttribute("aria-required")).toBe("true");
    expect(container.querySelector(`[id="${String(reason.getAttribute("aria-describedby"))}"]`)?.textContent).toContain(
      "Sent to the proposer",
    );
  });

  it("states a refused rejection as a sentence and sends the reason the contract defines", async () => {
    const bodies: unknown[] = [];
    const managedProposal = proposal(["view", "reject"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if ((init.method ?? "GET") === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return Response.json({}, { status: 409 });
        }
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
    await act(() => render(record(), container));
    await settle();
    await settle();

    // The control is refused until there is a reason to send.
    expect(buttonNamed(container, "Reject proposal").disabled).toBe(true);
    await typeMarkdown(container, "Rejection reason", "Outside this group's remit.");
    await act(() => buttonNamed(container, "Reject proposal").click());
    await settle();

    expect(groupVoteProposalRejectSchema.parse(bodies[0])).toMatchObject({
      reason: "Outside this group's remit.",
    });
    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("Someone else changed this at the same time.");
    expect(alert?.textContent).not.toContain("HTTP 409");
  });
});
