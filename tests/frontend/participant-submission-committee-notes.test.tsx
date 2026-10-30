// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantSubmission } from "../../assets/ts/components/events/ParticipantSubmission";
import {
  proposalAccessPatchSchema,
  proposalAccessReadResponseSchema,
} from "../../assets/shared/schemas/proposal-management";
import { eventFormsResponseSchema } from "../../assets/shared/schemas/forms";
import { PROPOSAL_COMMITTEE_NOTES_COPY } from "../../assets/shared/proposal-committee-notes-copy";
import { controlFor } from "./helpers/labeled-control";
import { expectAbstractShownAsText, MARKUP_LIKE_ABSTRACT } from "./helpers/markup-like-abstract";

const proposalId = "30000000-0000-4000-8000-000000000001";
const eventId = "10000000-0000-4000-8000-000000000001";

function submission(
  status: string,
  notes: string | null,
  abstract = "A walk through migrating a working certificate authority to post-quantum algorithms.",
) {
  return proposalAccessReadResponseSchema.parse({
    success: true,
    proposal: {
      id: proposalId,
      event_id: eventId,
      proposer_user_id: "20000000-0000-4000-8000-000000000001",
      status,
      proposal_type: "talk",
      title: "Post-quantum migration",
      abstract,
      committee_notes: notes,
      details: null,
    },
    speakers: [],
  });
}
const forms = eventFormsResponseSchema.parse({
  event: { id: eventId, slug: "pqc-2026", name: "PQC 2026" },
  purpose: "proposal_submission",
  form: null,
  registrationPolicy: "public",
  requiredTerms: [],
  allowedSessionTypes: ["talk"],
  eventDays: [],
});

let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(status: string, notes: string | null, abstract?: string) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <ParticipantSubmission
        data={submission(status, notes, abstract)}
        forms={forms}
        event={{ startsAt: null, endsAt: null, timezone: "UTC" } as never}
        facet="submission"
        reload={async () => {}}
      />,
      host,
    ),
  );
}
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label)!;

describe("notes for the program committee on the proposer's page", () => {
  it("lets the proposer edit them while the proposal is under review", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ success: true, proposal: submission("submitted", "Happy to run a workshop.").proposal });
      }),
    );
    await mount("submitted", "First thoughts.");
    expect(host.textContent).toContain("First thoughts.");
    await act(() => button("Edit").click());
    const notes = controlFor<HTMLTextAreaElement>(host, PROPOSAL_COMMITTEE_NOTES_COPY.label);
    expect(notes.value).toBe("First thoughts.");
    await act(() => {
      notes.value = "Happy to run a workshop.";
      notes.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Save proposal").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(proposalAccessPatchSchema.parse(sent[0]).committeeNotes).toBe("Happy to run a workshop.");
  });

  it("shows them read-only, and says they are locked, once the proposal is decided", async () => {
    await mount("accepted", "Written before the decision.");
    expect(host.textContent).toContain("Written before the decision.");
    expect(host.textContent).toContain(PROPOSAL_COMMITTEE_NOTES_COPY.locked);
    expect(button("Edit")).toBeUndefined();
    expect(host.querySelector('textarea[name="committeeNotes"]')).toBeNull();
  });
});

describe("the abstract on the proposer's page", () => {
  it("shows markup-like characters exactly once, as text", async () => {
    await mount("submitted", null, MARKUP_LIKE_ABSTRACT);
    expectAbstractShownAsText(host);
  });
});
