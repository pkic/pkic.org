// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupVoteDetail } from "../../assets/shared/schemas/group-votes";
import {
  groupVoteCreateInputSchema,
  groupVoteVisibilityUpdateInputSchema,
} from "../../assets/shared/schemas/group-vote-management";
import { groupVoteProposalRejectSchema } from "../../assets/shared/schemas/group-vote-proposals";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupVoteCreateForm } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteCreateForm";
import { GroupVoteManagementControls } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteManagementControls";
import { GroupVoteProposals } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteProposals";
import { confirmationButton, openConfirmation } from "./helpers/confirm-dialog";
// The `for`/`id` pair and a button's visible text are resolved by the
// shared helpers rather than re-derived here: one definition of "the
// control this label names" is what keeps every form test honest.
import { buttonNamed, controlFor as labeledControl } from "./helpers/labelled-control";

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

/**
 * A `<section>` is only announced as a region when it carries a name, and the
 * name has to survive serialization — it is an attribute relationship, not
 * something wired up at runtime. This resolves the relationship the way a
 * screen reader does, so a section that lost its `aria-labelledby` target
 * fails here rather than silently becoming an unnamed box.
 */
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
      setValue(labeledControl<HTMLInputElement>(container, "Title"), "Architecture motion");
      setValue(labeledControl<HTMLInputElement>(container, "Closes at"), "2026-09-01T12:00");
    });
    await act(() => (container.querySelector("button[type='submit']") as HTMLButtonElement).click());
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe(`/api/v1/groups/${GROUP_ID}/votes`);
    expect(groupVoteCreateInputSchema.parse(requests[0]?.body)).toMatchObject({
      title: "Architecture motion",
      voteType: "motion",
    });
    expect(requests[0]?.body).not.toHaveProperty("ownerGroupId");
  });

  it("names the create form and pairs every label with the control it describes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupVoteCreateForm groupId={GROUP_ID} onCreated={async () => {}} />, container));

    expect(container.querySelector("form")?.getAttribute("aria-label")).toBe("Create vote");

    // No orphaned `for` attributes: every label points at a control that is
    // actually in the form.
    const labels = Array.from(container.querySelectorAll("label"));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(container.querySelector(`[id="${label.htmlFor}"]`)).not.toBeNull();
    }

    expect(labeledControl<HTMLInputElement>(container, "Title").required).toBe(true);
    expect(labeledControl<HTMLInputElement>(container, "Closes at").required).toBe(true);
    expect(labeledControl<HTMLInputElement>(container, "Opens at").required).toBe(false);

    // Guidance reaches a screen reader through aria-describedby rather than
    // sitting beside the control as unassociated text.
    const turnout = labeledControl<HTMLInputElement>(container, "Minimum turnout");
    const describedBy = turnout.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`[id="${String(describedBy)}"]`)?.textContent).toContain(
      "majority of those who cast a vote",
    );
  });

  it("states a refused create as a sentence and keeps what was typed", async () => {
    const created = vi.fn(async () => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 403 })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupVoteCreateForm groupId={GROUP_ID} onCreated={created} />, container));
    await act(() => {
      setValue(labeledControl<HTMLInputElement>(container, "Title"), "Architecture motion");
      setValue(labeledControl<HTMLInputElement>(container, "Closes at"), "2026-09-01T12:00");
    });
    await act(() => (container.querySelector("button[type='submit']") as HTMLButtonElement).click());
    await settle();

    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("You don't have access to this.");
    expect(alert?.textContent).not.toContain("HTTP 403");
    expect(created).not.toHaveBeenCalled();
    // A failed create must not throw away the draft the member just entered.
    expect(labeledControl<HTMLInputElement>(container, "Title").value).toBe("Architecture motion");
  });

  it("names each candidate remove control after the row it removes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupVoteCreateForm groupId={GROUP_ID} onCreated={async () => {}} />, container));

    const type = labeledControl<HTMLSelectElement>(container, "Type");
    await act(() => {
      type.value = "election";
      type.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const removeLabels = Array.from(container.querySelectorAll("button"))
      .map((button) => button.textContent?.trim())
      .filter((label) => label?.startsWith("Remove candidate"));
    expect(removeLabels).toEqual(["Remove candidate 1", "Remove candidate 2"]);
    expect(labeledControl<HTMLInputElement>(container, "Candidate 1 name")).not.toBeNull();
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
    await act(() => buttonNamed(container, "Save visibility").click());
    await settle();

    const visibilityRequest = requests.find((request) => request.path.endsWith(`/votes/${VOTE_ID}/visibility`));
    expect(visibilityRequest?.method).toBe("PATCH");
    // Parsed through the shared request contract rather than compared to a
    // literal: a literal match would still pass if the schema moved on.
    expect(groupVoteVisibilityUpdateInputSchema.parse(visibilityRequest?.body)).toMatchObject({
      visibility: "public",
      publicDetailLevel: "aggregate",
    });
  });

  it("names the vote management region and every control inside it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ballots: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <GroupVoteManagementControls groupId={GROUP_ID} vote={managedVote()} onChanged={async () => {}} />,
        container,
      ),
    );

    // A <section> with no name is announced as nothing at all, and this one
    // is what the management surface is located by.
    expect(namedRegion(container, "Vote management")).toBeTruthy();

    // Both forms are named, so a reader tabbing between them is told which
    // one they have landed in.
    expect(Array.from(container.querySelectorAll("form")).map((form) => form.getAttribute("aria-label"))).toEqual([
      "Vote settings",
      "Vote visibility",
    ]);

    // No orphaned `for` attributes: every label points at a real control.
    const labels = Array.from(container.querySelectorAll("label"));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(container.querySelector(`[id="${label.htmlFor}"]`)).not.toBeNull();
    }
    expect(labeledControl<HTMLInputElement>(container, "Title").required).toBe(true);
    expect(labeledControl<HTMLInputElement>(container, "Closes at").required).toBe(true);

    // The disclosure says whether it is open, rather than relying on the
    // caption changing.
    const ballots = buttonNamed(container, "Load identifiable ballots");
    expect(ballots.getAttribute("aria-expanded")).toBe("false");
    await act(() => ballots.click());
    await settle();
    expect(buttonNamed(container, "Hide identifiable ballots").getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("table caption")?.textContent).toBe("Identifiable ballots");
  });

  it("states a refused settings save as a sentence and keeps the edit", async () => {
    const changed = vi.fn(async () => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 403 })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(<GroupVoteManagementControls groupId={GROUP_ID} vote={managedVote()} onChanged={changed} />, container),
    );
    await act(() => {
      setValue(labeledControl<HTMLInputElement>(container, "Title"), "Revised architecture motion");
    });
    await act(() => buttonNamed(container, "Save settings").click());
    await settle();

    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("You don't have access to this.");
    expect(alert?.textContent).not.toContain("HTTP 403");
    expect(changed).not.toHaveBeenCalled();
    // A refused save must not discard what the manager just typed.
    expect(labeledControl<HTMLInputElement>(container, "Title").value).toBe("Revised architecture motion");
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
    await act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <GroupVoteProposals groupId={GROUP_ID} canParticipate={false} />
        </>,
        container,
      ),
    );
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
    await act(() => confirmDialogButton("Approve and create vote").click());
    await settle();

    expect(requests).toContainEqual({
      path: `/api/v1/groups/${GROUP_ID}/vote-proposals/${PROPOSAL_ID}/approve`,
      method: "POST",
    });
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
          <GroupVoteProposals groupId={GROUP_ID} canParticipate={false} />
        </>,
        container,
      ),
    );
    await settle();
    await act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Details",
        ) as HTMLButtonElement
      ).click(),
    );
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

  it("names the proposal list and the region an expanded proposal opens", async () => {
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
    await act(() => render(<GroupVoteProposals groupId={GROUP_ID} canParticipate={false} />, container));
    await settle();

    // Four unnamed tables on a page are announced as four tables.
    expect(container.querySelector("table caption")?.textContent).toBe("Vote proposals");

    const details = buttonNamed(container, "Details");
    expect(details.getAttribute("aria-expanded")).toBe("false");
    await act(() => details.click());
    await settle();

    // The expanded detail is a region named after the proposal it belongs
    // to, so it can be reached without depending on a styling class.
    expect(namedRegion(container, managedProposal.title)).toBeTruthy();
    expect(buttonNamed(container, "Hide").getAttribute("aria-expanded")).toBe("true");
    // The rejection reason is a required, described control, not a bare box.
    const reason = labeledControl<HTMLTextAreaElement>(container, "Rejection reason");
    expect(reason.required).toBe(true);
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
    await act(() => render(<GroupVoteProposals groupId={GROUP_ID} canParticipate={false} />, container));
    await settle();
    await act(() => buttonNamed(container, "Details").click());
    await settle();

    // The control is refused until there is a reason to send.
    expect(buttonNamed(container, "Reject proposal").disabled).toBe(true);
    await act(() => {
      setValue(labeledControl<HTMLTextAreaElement>(container, "Rejection reason"), "Outside this group's remit.");
    });
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
