// @vitest-environment jsdom
/**
 * The staff-only timeline on a membership application, and the two forms that
 * add to it.
 *
 * What is asserted here is what a visual review cannot see: that the record
 * table names itself among the page's several tables, that every control is
 * reachable through its own label's `for`/`id` pair, that an empty required
 * value is reported on the control it belongs to rather than by the submit
 * quietly doing nothing, that a rejected request is announced instead of
 * discarded, and that what the surface sends satisfies the canonical request
 * contract rather than a literal copy of itself.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applicationCommunicationCreateSchema,
  applicationNoteCreateSchema,
  type MembershipApplicationCommunication,
  type MembershipApplicationDetail,
} from "../../assets/shared/schemas/membership-application-management";
import { ApplicationCommunicationsCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationCommunicationsCard";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { buttonNamed, buttonNames, controlFor, labelNames, typeInto } from "./helpers/labelled-control";

const NOW = "2026-08-31T09:00:00.000Z";

function communication(
  overrides: Partial<MembershipApplicationCommunication> = {},
): MembershipApplicationCommunication {
  return {
    id: "00000000-0000-4000-8000-000000000401",
    applicationId: "00000000-0000-4000-8000-000000000301",
    kind: "communication",
    actorUserId: "00000000-0000-4000-8000-0000000000ff",
    subject: "Your application",
    body: "We have received your application.",
    templateKey: null,
    emailOutboxId: null,
    createdAt: NOW,
    ...overrides,
  };
}

function detail(communications: MembershipApplicationCommunication[] = []): MembershipApplicationDetail {
  return {
    id: "00000000-0000-4000-8000-000000000301",
    applicantEmail: "applicant@example.test",
    applicantName: "Example Applicant",
    organizationName: "Example Organization",
    membershipCategory: "F",
    membershipCategoryLabel: "General Member",
    stage: "ec_review",
    onHoldSubtype: null,
    assignedToUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    stageEnteredAt: NOW,
    answers: {},
    requestedWorkingGroups: [],
    events: [],
    communications,
    concerns: [],
    ecDecisions: [],
  } as MembershipApplicationDetail;
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

/** The form whose heading reads `heading` — the card renders two of them. */
function formUnder(root: ParentNode, heading: string): HTMLFormElement {
  const match = [...root.querySelectorAll("form")].find(
    (candidate) => candidate.querySelector("h4")?.textContent === heading,
  );
  if (!match) throw new Error(`no form is headed "${heading}"`);
  return match;
}

async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** A refused request, as the API client raises one. */
function refused(status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) {
  return new ApiClientError({ error: { code, message, details: fieldErrors ? { fieldErrors } : undefined } }, status);
}

function fieldOf(control: HTMLElement): HTMLElement {
  const field = control.closest<HTMLElement>(".pk-field");
  if (!field) throw new Error("control is not inside a Field");
  return field;
}

/** The message a control points at through `aria-describedby`. */
function describedBy(root: ParentNode, control: HTMLElement): HTMLElement | null {
  const id = control.getAttribute("aria-describedby");
  return id ? root.querySelector<HTMLElement>(`[id="${id}"]`) : null;
}

function mountCard(props: Partial<Parameters<typeof ApplicationCommunicationsCard>[0]> = {}): HTMLElement {
  return mount(
    <ApplicationCommunicationsCard
      detail={detail()}
      canWrite
      onSendCommunication={vi.fn(async () => undefined)}
      onAddNote={vi.fn(async () => undefined)}
      {...props}
    />,
  );
}

describe("membership application communications card", () => {
  it("names itself and its record table, and says an empty timeline in words", () => {
    const page = mountCard();

    const region = page.querySelector("section");
    expect(region?.getAttribute("aria-label")).toBe("Communications and notes");
    expect(page.querySelector("h3")?.textContent).toBe("Communications and notes");

    // A table among a page of tables has to say which one it is; the caption
    // is the only thing that does.
    const caption = page.querySelector("caption");
    expect(caption?.textContent).toBe("Communication and note history");
    expect(page.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(page.textContent).toContain("Nothing has been emailed or noted on this application yet.");
  });

  it("shows each record with the word for its kind, not only a colour", () => {
    const page = mountCard({
      detail: detail([
        communication(),
        communication({
          id: "00000000-0000-4000-8000-000000000402",
          kind: "note",
          subject: null,
          body: "Waiting on the signed agreement.",
        }),
      ]),
    });

    const rows = [...page.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Emailed");
    expect(rows[0]?.textContent).toContain("Your application");
    expect(rows[1]?.textContent).toContain("Internal note");
    expect(rows[1]?.textContent).toContain("Waiting on the signed agreement.");
    // The kinds differ by their words, so the two tones are not the signal.
    expect(rows[1]?.textContent).not.toContain("Emailed");
  });

  it("names every control through its own label", () => {
    const page = mountCard();

    expect(labelNames(page)).toEqual(["Subject", "Message", "Internal note"]);
    expect(controlFor(page, "Subject").value).toBe("");
    expect(controlFor<HTMLTextAreaElement>(page, "Message").tagName).toBe("TEXTAREA");
    expect(controlFor<HTMLTextAreaElement>(page, "Internal note").tagName).toBe("TEXTAREA");
    expect(page.textContent).toContain("Never emailed. Visible to staff only.");
  });

  it("reports an empty required value on the control it belongs to and sends nothing", async () => {
    const onSendCommunication = vi.fn(async () => undefined);
    const page = mountCard({ onSendCommunication });

    await submit(formUnder(page, "Send communication"));

    expect(onSendCommunication).not.toHaveBeenCalled();

    // Refused by the request contract the route parses, on the field itself.
    const subject = controlFor(page, "Subject");
    expect(fieldOf(subject).classList.contains("pk-field--invalid")).toBe(true);
    expect(subject.getAttribute("aria-invalid")).toBe("true");
    const message = describedBy(page, subject);
    expect(message?.textContent).toContain("Enter a subject for the email.");
    // A blocking error interrupts rather than waiting its turn.
    expect(message?.getAttribute("role")).toBe("alert");

    const body = controlFor<HTMLTextAreaElement>(page, "Message");
    expect(body.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(page, body)?.textContent).toContain("Enter the message to send.");

    // The other form is untouched by the first one's failure.
    expect(controlFor<HTMLTextAreaElement>(page, "Internal note").getAttribute("aria-invalid")).toBeNull();
  });

  it("sends a communication the canonical contract accepts, then clears the form", async () => {
    const sent: unknown[] = [];
    const page = mountCard({
      onSendCommunication: vi.fn(async (params: { subject: string; body: string }) => {
        sent.push(params);
      }),
    });

    await typeInto(controlFor(page, "Subject"), "  Decision on your application  ");
    await typeInto(controlFor<HTMLTextAreaElement>(page, "Message"), "  The EC has reviewed it.  ");
    await submit(formUnder(page, "Send communication"));

    expect(sent).toHaveLength(1);
    // Checked against the shared contract, not against a literal copy of what
    // the component just sent.
    const parsed = applicationCommunicationCreateSchema.parse(sent[0]);
    expect(parsed).toEqual({ subject: "Decision on your application", body: "The EC has reviewed it." });

    expect(controlFor(page, "Subject").value).toBe("");
    expect(controlFor<HTMLTextAreaElement>(page, "Message").value).toBe("");
  });

  it("announces a rejected send and keeps what was typed", async () => {
    const page = mountCard({
      onSendCommunication: vi.fn(async () => {
        throw refused(502, "MAIL_FAILED", "The mail service refused this message.");
      }),
    });

    await typeInto(controlFor(page, "Subject"), "Decision");
    await typeInto(controlFor<HTMLTextAreaElement>(page, "Message"), "The EC has reviewed it.");
    await submit(formUnder(page, "Send communication"));

    const alert = [...page.querySelectorAll('[role="alert"]')].find((node) =>
      node.textContent?.includes("The mail service refused this message."),
    );
    expect(alert).toBeDefined();
    // A failed send is a retry, not a restart.
    expect(controlFor(page, "Subject").value).toBe("Decision");
    expect(controlFor<HTMLTextAreaElement>(page, "Message").value).toBe("The EC has reviewed it.");
    expect(buttonNamed(page, "Send")).toBeDefined();
  });

  it("marks the field a server refusal names and keeps what was typed", async () => {
    const page = mountCard({
      onSendCommunication: vi.fn(async () => {
        throw refused(400, "VALIDATION", "Invalid request", { subject: ["Subject is too long."] });
      }),
    });

    await typeInto(controlFor(page, "Subject"), "Decision");
    await typeInto(controlFor<HTMLTextAreaElement>(page, "Message"), "The EC has reviewed it.");
    await submit(formUnder(page, "Send communication"));

    // The refusal lands on the field the server named, the way the
    // contract's own refusal would, and the draft survives it.
    const subject = controlFor(page, "Subject");
    expect(fieldOf(subject).classList.contains("pk-field--invalid")).toBe(true);
    expect(describedBy(page, subject)?.textContent).toContain("Subject is too long.");
    expect(document.activeElement).toBe(subject);
    expect(subject.value).toBe("Decision");
    // The other form is untouched by this one's refusal.
    expect(controlFor<HTMLTextAreaElement>(page, "Internal note").getAttribute("aria-invalid")).toBeNull();
  });

  it("records a note the canonical contract accepts, and reports an empty one", async () => {
    const added: unknown[] = [];
    const page = mountCard({
      onAddNote: vi.fn(async (body: string) => {
        added.push({ body });
      }),
    });

    await submit(formUnder(page, "Add internal note"));
    expect(added).toHaveLength(0);
    const note = controlFor<HTMLTextAreaElement>(page, "Internal note");
    expect(fieldOf(note).classList.contains("pk-field--invalid")).toBe(true);
    expect(note.getAttribute("aria-invalid")).toBe("true");
    const message = describedBy(page, note);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("Enter the note to record.");

    await typeInto(note, "  Chased the signed agreement.  ");
    await submit(formUnder(page, "Add internal note"));

    expect(added).toHaveLength(1);
    expect(applicationNoteCreateSchema.parse(added[0])).toEqual({ body: "Chased the signed agreement." });
    expect(controlFor<HTMLTextAreaElement>(page, "Internal note").value).toBe("");
    expect(controlFor<HTMLTextAreaElement>(page, "Internal note").getAttribute("aria-invalid")).toBeNull();
  });

  it("offers a reader without write access the record, and no way to add to it", () => {
    const page = mountCard({ canWrite: false, detail: detail([communication()]) });

    expect(page.querySelector("caption")?.textContent).toBe("Communication and note history");
    expect(page.querySelectorAll("form")).toHaveLength(0);
    expect(labelNames(page)).toEqual([]);
    expect(buttonNames(page)).toEqual([]);
  });
});
