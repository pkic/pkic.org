// @vitest-environment jsdom
/**
 * The card staff move a membership application from.
 *
 * What is asserted here is what a visual review cannot see: that the card
 * names itself among the column of cards beside it, that each of its three
 * controls is reached through a real `for`/`id` pair rather than a `<label>`
 * pointing at nothing, that the optional note's help text is tied to the
 * control by `aria-describedby`, that the two permissions gate two different
 * controls, and that a refused transition keeps the reader's work instead of
 * clearing the form or escaping as an unhandled rejection.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MembershipApplicationDetail } from "../../assets/shared/schemas/membership-application-management";
import { ApplicationTransitionCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationTransitionCard";
import { buttonNamed, buttonNames, chooseOption, controlFor, labelNames, typeInto } from "./helpers/labelled-control";

const NOW = "2026-08-31T09:00:00.000Z";

function detail(overrides: Partial<MembershipApplicationDetail> = {}): MembershipApplicationDetail {
  return {
    id: "00000000-0000-4000-8000-000000000401",
    applicantEmail: "applicant@example.test",
    applicantName: "Example Applicant",
    organizationName: "Example Organization",
    membershipCategory: "F",
    membershipCategoryLabel: "General Member",
    stage: "in_review",
    onHoldSubtype: null,
    assignedToUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    stageEnteredAt: NOW,
    answers: {},
    requestedWorkingGroups: [],
    events: [],
    communications: [],
    concerns: [],
    ecDecisions: [],
    ...overrides,
  } as MembershipApplicationDetail;
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

function mountCard(props: Partial<Parameters<typeof ApplicationTransitionCard>[0]> = {}): HTMLElement {
  return mount(
    <ApplicationTransitionCard
      detail={detail()}
      canWrite
      canApprove={false}
      onApprove={vi.fn(async () => undefined)}
      onTransition={vi.fn(async () => undefined)}
      {...props}
    />,
  );
}

async function submit(root: ParentNode): Promise<void> {
  await act(async () => {
    root.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("membership application transition card", () => {
  it("names itself as a region and labels every control through a for/id pair", () => {
    const page = mountCard();

    const region = page.querySelector("section");
    expect(region?.getAttribute("aria-label")).toBe("Stage transition");
    expect(page.querySelector("h3")?.textContent).toBe("Stage transition");

    // The two labels the card starts with are its own; "Reason" only joins
    // them once on_hold is chosen.
    expect(labelNames(page)).toEqual(["Move to", "Note"]);

    // Resolved through the pair itself, so the lookup fails exactly when the
    // labelling is broken — which is what it used to be: three bare <label>s
    // with no `for` at all.
    expect(controlFor<HTMLSelectElement>(page, "Move to").tagName).toBe("SELECT");
    expect(controlFor(page, "Note").tagName).toBe("INPUT");

    // "(optional)" used to be part of the announced name. It is help text tied
    // to the control now, which is what aria-describedby is for.
    const note = controlFor(page, "Note");
    const describedBy = note.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(page.querySelector(`#${describedBy!}`)?.textContent).toContain("Optional.");
    // Optional means optional: nothing here is announced as an error.
    expect(note.getAttribute("aria-invalid")).toBeNull();
  });

  it("offers only the stages the transition graph allows from the current one", () => {
    const page = mountCard();
    const moveTo = controlFor<HTMLSelectElement>(page, "Move to");

    expect([...moveTo.options].map((option) => option.value)).toEqual([
      "",
      "on_hold",
      "in_consultation",
      "declined",
      "withdrawn",
    ]);
  });

  it("asks for an on-hold reason only when the chosen stage is on hold", async () => {
    const page = mountCard();
    expect(labelNames(page)).not.toContain("Reason");

    await chooseOption(controlFor(page, "Move to"), "on_hold");
    expect(labelNames(page)).toContain("Reason");
    expect(controlFor<HTMLSelectElement>(page, "Reason").value).toBe("request_authority");

    await chooseOption(controlFor(page, "Move to"), "declined");
    expect(labelNames(page)).not.toContain("Reason");
  });

  it("sends the chosen stage, reason and note, then clears the form", async () => {
    const onTransition = vi.fn(async () => undefined);
    const page = mountCard({ onTransition });

    await chooseOption(controlFor(page, "Move to"), "on_hold");
    await chooseOption(controlFor(page, "Reason"), "request_information");
    await typeInto(controlFor(page, "Note"), "Waiting on the signed authority letter");
    await submit(page);
    await settle();

    expect(onTransition).toHaveBeenCalledWith({
      toStage: "on_hold",
      onHoldSubtype: "request_information",
      note: "Waiting on the signed authority letter",
    });
    // A completed transition starts from a clean slate.
    expect(controlFor<HTMLSelectElement>(page, "Move to").value).toBe("");
    expect(controlFor(page, "Note").value).toBe("");
  });

  it("keeps the reader's work when the transition is refused", async () => {
    const rejection = vi.fn(() => {
      /* records unhandled rejections that escape the card */
    });
    process.on("unhandledRejection", rejection);
    const onTransition = vi.fn(async () => {
      throw new Error("HTTP 409");
    });
    const page = mountCard({ onTransition });

    await chooseOption(controlFor(page, "Move to"), "declined");
    await typeInto(controlFor(page, "Note"), "Declined at the applicant's request");
    await submit(page);
    await settle();
    process.off("unhandledRejection", rejection);

    expect(onTransition).toHaveBeenCalledOnce();
    // A failed transition is a retry, not a restart.
    expect(controlFor<HTMLSelectElement>(page, "Move to").value).toBe("declined");
    expect(controlFor(page, "Note").value).toBe("Declined at the applicant's request");
    // And the control is usable again rather than stuck mid-flight.
    expect(buttonNamed(page, "Transition").getAttribute("aria-busy")).toBeNull();
    expect(rejection).not.toHaveBeenCalled();
  });

  it("will not submit before a stage is chosen", async () => {
    const onTransition = vi.fn(async () => undefined);
    const page = mountCard({ onTransition });

    expect(buttonNamed(page, "Transition").disabled).toBe(true);
    await submit(page);
    await settle();

    expect(onTransition).not.toHaveBeenCalled();
  });

  it("says so in a sentence when the stage is terminal, rather than offering an empty form", () => {
    const page = mountCard({ detail: detail({ stage: "approved" }) });

    expect(page.textContent).toContain("No further transitions from this stage.");
    expect(page.querySelector("form")).toBeNull();
    expect(labelNames(page)).toEqual([]);
  });

  it("gates the transition form and the approval on their own permissions", async () => {
    const onApprove = vi.fn(async () => undefined);

    // Approve alone: the button, and no form at all.
    const approver = mountCard({
      detail: detail({ stage: "ec_review" }),
      canWrite: false,
      canApprove: true,
      onApprove,
    });
    expect(approver.querySelector("form")).toBeNull();
    expect(approver.querySelector("select")).toBeNull();
    await act(() => buttonNamed(approver, "Approve & run onboarding").click());
    expect(onApprove).toHaveBeenCalledOnce();

    void act(() => render(null, container!));
    container!.remove();
    container = null;

    // Write alone at the same stage: the form, and no approval.
    const writer = mountCard({ detail: detail({ stage: "ec_review" }), canWrite: true, canApprove: false });
    expect(buttonNames(writer)).not.toContain("Approve & run onboarding");
    expect(buttonNames(writer)).toContain("Transition");
  });

  it("offers no approval before the application reaches EC review", () => {
    const page = mountCard({ canApprove: true });

    expect(buttonNames(page)).not.toContain("Approve & run onboarding");
  });
});
