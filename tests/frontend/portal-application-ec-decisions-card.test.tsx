// @vitest-environment jsdom
/**
 * The Executive Committee's decisions on one application, and the staff
 * override beside them.
 *
 * What is asserted here is what a visual review cannot see: that the decision
 * history names itself among the column of tables on the page, that every
 * control in the override form is reachable through its own label rather than
 * through a placeholder that disappears when typing starts, that the two ways
 * the form can refuse a submission are announced on the field they belong to,
 * and that a rejected request is stated on the surface instead of discarded.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ecDecisionCreateSchema, type EcDecisionValue } from "../../assets/shared/schemas/ec-review";
import type { MembershipApplicationDetail } from "../../assets/shared/schemas/membership-application-management";
import { ApplicationEcDecisionsCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationEcDecisionsCard";
import { buttonNamed, chooseOption, controlFor, labelNames, submitForm, typeInto } from "./helpers/labelled-control";

const NOW = "2026-08-31T09:00:00.000Z";

function detail(overrides: Partial<MembershipApplicationDetail> = {}): MembershipApplicationDetail {
  return {
    id: "00000000-0000-4000-8000-000000000401",
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
    communications: [],
    concerns: [],
    ecDecisions: [],
    ...overrides,
  } as MembershipApplicationDetail;
}

const DECISION = {
  id: "ec-decision-1",
  applicationId: "00000000-0000-4000-8000-000000000401",
  ecMemberUserId: "ec-member-1",
  decision: "approve" as const,
  reason: "Meets every criterion.",
  createdAt: NOW,
};

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

afterEach(() => {
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
});

function card(overrides: Partial<Parameters<typeof ApplicationEcDecisionsCard>[0]> = {}) {
  return <ApplicationEcDecisionsCard detail={detail()} canApprove onRecordEcDecision={async () => {}} {...overrides} />;
}

describe("the EC decisions card", () => {
  it("captions the decision history so it is identifiable among the page's tables", () => {
    const root = mount(card({ detail: detail({ ecDecisions: [DECISION] }) }));

    const caption = root.querySelector("caption");
    expect(caption?.textContent).toBe("Executive Committee decisions on this application");
    expect(root.textContent).toContain("Meets every criterion.");
    expect(root.textContent).toContain("ec-member-1");
  });

  it("says the region is empty rather than leaving it blank", () => {
    const root = mount(card());

    expect(root.textContent).toContain("No Executive Committee decision has been recorded");
  });

  it("names every override control through its own label", () => {
    const root = mount(card());

    expect(labelNames(root)).toEqual(["EC member user ID", "Decision", "Reason"]);
    // Each label resolves to a real control through its own for/id pair, so
    // the lookup fails exactly when the labelling contract is broken.
    expect(controlFor(root, "EC member user ID").tagName).toBe("INPUT");
    expect(controlFor<HTMLSelectElement>(root, "Decision").tagName).toBe("SELECT");
  });

  it("hides the override from staff who cannot approve", () => {
    const root = mount(card({ canApprove: false, detail: detail({ ecDecisions: [DECISION] }) }));

    expect(root.querySelector("form")).toBeNull();
    expect(root.textContent).toContain("Meets every criterion.");
  });

  it("reports a missing EC member on the field instead of returning in silence", async () => {
    const onRecordEcDecision = vi.fn(async () => {});
    const root = mount(card({ onRecordEcDecision }));

    await submitForm(root);

    const control = controlFor(root, "EC member user ID");
    expect(control.getAttribute("aria-invalid")).toBe("true");
    const message = root.querySelector(`#${control.getAttribute("aria-describedby")!}`);
    expect(message?.textContent).toContain("Enter the user ID of the EC member");
    expect(message?.getAttribute("role")).toBe("alert");
    expect(onRecordEcDecision).not.toHaveBeenCalled();
  });

  it("refuses a decline with no reason, the way the shared contract does", async () => {
    const onRecordEcDecision = vi.fn(async () => {});
    const root = mount(card({ onRecordEcDecision }));

    await typeInto(controlFor(root, "EC member user ID"), "ec-member-2");
    await chooseOption(controlFor<HTMLSelectElement>(root, "Decision"), "decline");
    await submitForm(root);

    const reason = controlFor(root, "Reason");
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(onRecordEcDecision).not.toHaveBeenCalled();
    // The same refusal the backend contract makes, stated before the request.
    expect(ecDecisionCreateSchema.safeParse({ decision: "decline" }).success).toBe(false);
  });

  it("records a valid decision as the shared create contract and clears the form", async () => {
    const recordedCalls: Array<{ ecMemberUserId: string; decision: EcDecisionValue; reason?: string }> = [];
    const root = mount(
      card({
        onRecordEcDecision: async (params) => {
          recordedCalls.push(params);
        },
      }),
    );

    await typeInto(controlFor(root, "EC member user ID"), "  ec-member-3  ");
    await chooseOption(controlFor<HTMLSelectElement>(root, "Decision"), "decline");
    await typeInto(controlFor(root, "Reason"), "  Insufficient evidence of eligibility.  ");
    await submitForm(root);

    const recorded = recordedCalls[0];
    expect(recorded.ecMemberUserId).toBe("ec-member-3");
    // Parsed through the canonical schema rather than compared to a literal,
    // so the assertion breaks if the payload stops being a valid decision.
    expect(ecDecisionCreateSchema.parse({ decision: recorded.decision, reason: recorded.reason })).toEqual({
      decision: "decline",
      reason: "Insufficient evidence of eligibility.",
    });
    expect(controlFor(root, "EC member user ID").value).toBe("");
    expect(controlFor(root, "Reason").value).toBe("");
  });

  it("states a refused request on the surface and keeps what was typed", async () => {
    const root = mount(
      card({
        onRecordEcDecision: async () => {
          throw new Error("That user is not on the Executive Committee.");
        },
      }),
    );

    await typeInto(controlFor(root, "EC member user ID"), "not-an-ec-member");
    await submitForm(root);

    // A toast can be gone before the reader looks up; the card must say so
    // itself, and must not discard the identifier that was typed.
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That user is not on the Executive Committee.");
    expect(controlFor(root, "EC member user ID").value).toBe("not-an-ec-member");
    expect(buttonNamed(root, "Record").disabled).toBe(false);
  });
});
