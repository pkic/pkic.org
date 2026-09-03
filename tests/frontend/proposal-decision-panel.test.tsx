// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { finalizeProposalSchema } from "../../assets/shared/schemas/proposal-management";
import { ProposalDecisionPanel } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/ProposalDecisionPanel";
import type { ProposalDetailRecord } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/model";
import { chooseOption, controlFor, submitForm, typeInto } from "./helpers/labelled-control";

const proposal: ProposalDetailRecord = {
  id: "proposal-1",
  event_id: "event-1",
  proposer_user_id: "user-1",
  status: "needs-work",
  proposal_type: "talk",
  title: "Unanswered proposal",
  abstract: "The proposer has not submitted the requested changes.",
  review_round: 1,
  submitted_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
  canceled_at: null,
  cancellation_comment: null,
  proposer_email: "proposer@example.test",
  proposer_first_name: "Proposal",
  proposer_last_name: "Owner",
  review_count: 2,
  decision_status: "needs-work",
  decision_note: "Please clarify the implementation plan.",
  decision_decided_at: "2026-08-02T00:00:00.000Z",
  details: null,
};

const editableProposal: ProposalDetailRecord = {
  ...proposal,
  status: "submitted",
  decision_status: null,
  decision_note: null,
  decision_decided_at: null,
};

const previewResponse = {
  success: true,
  recipientCount: 1,
  emailCount: 1,
  layoutMissing: false,
  missingTemplateKeys: [],
  messages: [
    {
      id: "proposal-decision:user-1",
      templateKey: "proposal_decision",
      recipientEmail: "proposer@example.test",
      recipientLabel: "Proposal Owner",
      subject: "Proposal update",
      html: "<p>Accepted</p>",
      text: "Accepted",
      templateMissing: false,
    },
  ],
};

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

let container: HTMLElement | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Stubs fetch: previews always succeed; `decide` answers the decision itself. */
function stubApi(decide: () => Response): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const rawBody = init?.body?.toString() ?? null;
      requests.push({ url, method: init?.method ?? "GET", body: rawBody ? JSON.parse(rawBody) : null });
      if (url.endsWith("/decisions/previews")) return json(previewResponse);
      return decide();
    }),
  );
  return requests;
}

function mount(record: ProposalDetailRecord, onSaved = () => {}): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() =>
    render(
      <ProposalDecisionPanel
        proposalId={record.id}
        proposal={record}
        reviewCount={2}
        minReviewsRequired={2}
        loading={false}
        onSaved={onSaved}
      />,
      container!,
    ),
  );
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function buttonNamed(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes(label));
  if (!found) throw new Error(`no button reads "${label}"`);
  return found;
}

function fieldOf(control: HTMLElement): HTMLElement {
  return control.closest<HTMLElement>(".pk-field")!;
}

function messageOf(root: ParentNode, control: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[id="${control.getAttribute("aria-describedby") ?? ""}"]`);
}

/** Chooses the decision, previews it and confirms the preview. */
async function previewAndConfirm(root: HTMLElement, status: string, note?: string): Promise<void> {
  await chooseOption(controlFor<HTMLSelectElement>(root, "Decision"), status);
  if (note !== undefined) await typeInto(controlFor<HTMLTextAreaElement>(root, "Note to applicant"), note);
  await act(() => buttonNamed(root, "Preview emails").click());
  await settle();
  const confirmation = root.querySelector("#proposal-decision-preview-confirm") as HTMLInputElement;
  await act(() => {
    confirmation.checked = true;
    confirmation.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
});

describe("proposal decision panel", () => {
  it("reads a recorded decision as a decision, with correcting it a deliberate act", () => {
    const root = mount(proposal);

    expect(root.textContent).toContain("Decision recorded:");
    expect(root.textContent).toContain("Please clarify the implementation plan.");
    // The form is not standing open under the decision it would replace.
    expect(root.querySelector("form")).toBeNull();
    expect(buttonNamed(root, "Change decision")).not.toBeNull();
  });

  it("reopens the form on request, offering every decision the shared policy allows", () => {
    const root = mount(proposal);
    void act(() => buttonNamed(root, "Change decision").click());

    expect([...root.querySelectorAll("select option")].map((option) => option.getAttribute("value"))).toEqual([
      "",
      "accepted",
      "rejected",
      "needs-work",
    ]);
    expect(root.querySelector('button[type="submit"]')?.textContent).toContain("Record Decision");
  });

  it("lets an accepted decision be corrected too, and shows it as recorded until then", () => {
    const root = mount({ ...proposal, status: "accepted", decision_status: "accepted" });

    expect(root.textContent).toContain("Decision recorded:");
    expect(root.querySelector("form")).toBeNull();
    void act(() => buttonNamed(root, "Change decision").click());
    expect(root.querySelector("form")).not.toBeNull();
  });

  it("previews before confirming, then records a decision the shared contract accepts", async () => {
    const requests = stubApi(() =>
      json({
        success: true,
        decisionId: "5555555555555555555555555555ffff",
        reviewRound: 1,
        reviewCount: 2,
        minReviewsRequired: 2,
      }),
    );
    const onSaved = vi.fn();
    const root = mount(editableProposal, onSaved);

    // Nothing to send yet: the contract has no decision, so neither button
    // is live, and the untouched form is not covered in red.
    expect(buttonNamed(root, "Preview emails").disabled).toBe(true);
    expect(root.querySelector(".pk-field--invalid")).toBeNull();

    await chooseOption(controlFor<HTMLSelectElement>(root, "Decision"), "accepted");
    await act(() => buttonNamed(root, "Preview emails").click());
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: "/api/v1/proposals/proposal-1/decisions/previews", method: "POST" });
    expect(root.textContent).toContain("Email preview");
    const recordButton = root.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(recordButton.disabled).toBe(true);

    // The confirmation is the design system's checkbox, named by its label.
    const confirmation = root.querySelector("#proposal-decision-preview-confirm") as HTMLInputElement;
    expect(confirmation.closest("label")?.classList.contains("pk-check")).toBe(true);
    await act(() => {
      confirmation.checked = true;
      confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(recordButton.disabled).toBe(false);
    await act(() => recordButton.click());
    await settle();

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ url: "/api/v1/proposals/proposal-1/decisions", method: "POST" });
    // Both bodies are what the finalize contract makes of the draft — the
    // preview and the decision are one input, parsed once.
    for (const request of requests) {
      expect(finalizeProposalSchema.parse(request.body)).toEqual({ finalStatus: "accepted" });
    }
    expect(requests.every(({ url }) => !url.includes("/api/v1/admin/"))).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("refuses a needs-work decision without a note on the note itself, and sends nothing", async () => {
    const requests = stubApi(() => json({ success: true }));
    const root = mount(editableProposal);

    await chooseOption(controlFor<HTMLSelectElement>(root, "Decision"), "needs-work");
    // The contract requires the note for this decision; the buttons wait for it.
    const note = controlFor<HTMLTextAreaElement>(root, "Note to applicant");
    expect(note.required).toBe(true);
    expect(buttonNamed(root, "Preview emails").disabled).toBe(true);

    // Submitting the form anyway is refused at the field, not at the server.
    await submitForm(root);
    expect(fieldOf(note).classList.contains("pk-field--invalid")).toBe(true);
    expect(note.getAttribute("aria-invalid")).toBe("true");
    const message = messageOf(root, note);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("A decision note is required when requesting changes");
    expect(requests).toHaveLength(0);

    // The contract also has a floor for the note; too short is still refused.
    await typeInto(note, "ok");
    expect(fieldOf(note).classList.contains("pk-field--invalid")).toBe(true);
    await typeInto(note, "Please expand the evaluation section.");
    expect(fieldOf(note).classList.contains("pk-field--ok")).toBe(true);
    expect(buttonNamed(root, "Preview emails").disabled).toBe(false);
  });

  it("marks the field a server refusal names, and keeps the decision on the form", async () => {
    stubApi(() =>
      json(
        {
          error: {
            code: "VALIDATION",
            message: "Invalid request",
            details: { fieldErrors: { decisionNote: ["The note may not mention other proposals."] } },
          },
        },
        400,
      ),
    );
    const onSaved = vi.fn();
    const root = mount(editableProposal, onSaved);
    await previewAndConfirm(root, "rejected", "See proposal 12 instead.");
    await act(() => (root.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    await settle();

    const note = controlFor<HTMLTextAreaElement>(root, "Note to applicant");
    expect(note.value).toBe("See proposal 12 instead.");
    expect(fieldOf(note).classList.contains("pk-field--invalid")).toBe(true);
    expect(messageOf(root, note)?.getAttribute("role")).toBe("alert");
    expect(messageOf(root, note)?.textContent).toContain("The note may not mention other proposals.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps the form when the server refuses the decision without naming a field", async () => {
    stubApi(() => json({ error: { code: "QUORUM_NOT_MET", message: "Two reviews are required first." } }, 409));
    const onSaved = vi.fn();
    const root = mount(editableProposal, onSaved);
    await previewAndConfirm(root, "accepted");
    await act(() => (root.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    await settle();

    // No field said anything wrong, so none is marked; the decision stays
    // chosen for the reader to retry.
    expect(root.querySelector(".pk-field--invalid")).toBeNull();
    expect(controlFor<HTMLSelectElement>(root, "Decision").value).toBe("accepted");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
