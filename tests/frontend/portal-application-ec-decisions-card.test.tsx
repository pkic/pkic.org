// @vitest-environment jsdom
/**
 * The Executive Committee's decisions on one application, and the staff
 * override beside them.
 *
 * What is asserted here is what a visual review cannot see: that the decision
 * history names itself among the column of tables on the page, that every
 * control in the override form is reachable through its own label rather than
 * through a placeholder that disappears when typing starts, that the two ways
 * the shared decision contract can refuse a submission are announced on the
 * field they belong to, that a refusal the server names lands on the same
 * field, and that a rejected request is stated on the surface instead of
 * discarded.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ecDecisionCreateSchema } from "../../assets/shared/schemas/ec-review";
import {
  ecDecisionRecordSchema,
  type EcDecisionRecordInput,
  type MembershipApplicationDetail,
} from "../../assets/shared/schemas/membership-application-management";
import { ApplicationEcDecisionsCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationEcDecisionsCard";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { normalizeValidation } from "../../assets/ts/shared/form/validation-map";
import { buttonNamed, chooseOption, controlFor, labelNames, submitForm, typeInto } from "./helpers/labelled-control";

const NOW = "2026-08-31T09:00:00.000Z";
const EC_MEMBER_ID = "00000000-0000-4000-8000-0000000000e1";
const OTHER_EC_MEMBER_ID = "00000000-0000-4000-8000-0000000000e2";

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
  ecMemberUserId: EC_MEMBER_ID,
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

/** A refused request, as the API client raises one. */
function refused(status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) {
  return new ApiClientError({ error: { code, message, details: fieldErrors ? { fieldErrors } : undefined } }, status);
}

describe("the EC decisions card", () => {
  it("captions the decision history so it is identifiable among the page's tables", () => {
    const root = mount(card({ detail: detail({ ecDecisions: [DECISION] }) }));

    const caption = root.querySelector("caption");
    expect(caption?.textContent).toBe("Executive Committee decisions on this application");
    expect(root.textContent).toContain("Meets every criterion.");
    expect(root.textContent).toContain(EC_MEMBER_ID);
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

  it("refuses a missing EC member on the field instead of returning in silence", async () => {
    const onRecordEcDecision = vi.fn(async () => {});
    const root = mount(card({ onRecordEcDecision }));

    await submitForm(root);

    // The override names the member, so the empty identifier is sent to the
    // contract as typed and refused by it — with the contract's own words.
    const control = controlFor(root, "EC member user ID");
    expect(fieldOf(control).classList.contains("pk-field--invalid")).toBe(true);
    expect(control.getAttribute("aria-invalid")).toBe("true");
    const message = describedBy(root, control);
    expect(message?.getAttribute("role")).toBe("alert");
    const contract = ecDecisionRecordSchema.safeParse({ ecMemberUserId: "", decision: "approve" });
    expect(contract.success).toBe(false);
    expect(message?.textContent).toContain(normalizeValidation(contract.error).fields.ecMemberUserId);
    expect(document.activeElement).toBe(control);
    expect(onRecordEcDecision).not.toHaveBeenCalled();
  });

  it("refuses a decline with no reason, the way the shared contract does", async () => {
    const onRecordEcDecision = vi.fn(async () => {});
    const root = mount(card({ onRecordEcDecision }));

    await typeInto(controlFor(root, "EC member user ID"), OTHER_EC_MEMBER_ID);
    await chooseOption(controlFor<HTMLSelectElement>(root, "Decision"), "decline");
    await submitForm(root);

    const reason = controlFor(root, "Reason");
    expect(fieldOf(reason).classList.contains("pk-field--invalid")).toBe(true);
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(root, reason)?.textContent).toContain("A reason is required when declining");
    expect(onRecordEcDecision).not.toHaveBeenCalled();
    // The same refusal the backend contract makes, stated before the request.
    expect(ecDecisionCreateSchema.safeParse({ decision: "decline" }).success).toBe(false);
  });

  it("records a valid decision as the shared record contract and clears the form", async () => {
    const recordedCalls: EcDecisionRecordInput[] = [];
    const root = mount(
      card({
        onRecordEcDecision: async (params) => {
          recordedCalls.push(params);
        },
      }),
    );

    await typeInto(controlFor(root, "EC member user ID"), `  ${OTHER_EC_MEMBER_ID}  `);
    await chooseOption(controlFor<HTMLSelectElement>(root, "Decision"), "decline");
    await typeInto(controlFor(root, "Reason"), "  Insufficient evidence of eligibility.  ");
    await submitForm(root);

    expect(recordedCalls).toHaveLength(1);
    // Parsed through the canonical schema rather than compared to a literal,
    // so the assertion breaks if the payload stops being a valid decision.
    expect(ecDecisionRecordSchema.parse(recordedCalls[0])).toEqual({
      ecMemberUserId: OTHER_EC_MEMBER_ID,
      decision: "decline",
      reason: "Insufficient evidence of eligibility.",
    });
    expect(controlFor(root, "EC member user ID").value).toBe("");
    expect(controlFor(root, "Reason").value).toBe("");
    expect(controlFor(root, "EC member user ID").getAttribute("aria-invalid")).toBeNull();
  });

  it("marks the field a server refusal names and keeps what was typed", async () => {
    const root = mount(
      card({
        onRecordEcDecision: async () => {
          throw refused(400, "VALIDATION", "Invalid request", {
            ecMemberUserId: ["That user is not on the Executive Council."],
          });
        },
      }),
    );

    await typeInto(controlFor(root, "EC member user ID"), OTHER_EC_MEMBER_ID);
    await submitForm(root);

    const control = controlFor(root, "EC member user ID");
    expect(fieldOf(control).classList.contains("pk-field--invalid")).toBe(true);
    expect(describedBy(root, control)?.textContent).toContain("That user is not on the Executive Council.");
    expect(document.activeElement).toBe(control);
    expect(control.value).toBe(OTHER_EC_MEMBER_ID);
  });

  it("states a refused request on the surface and keeps what was typed", async () => {
    const root = mount(
      card({
        onRecordEcDecision: async () => {
          throw refused(409, "NOT_IN_EC_REVIEW", "This application is not in EC review.");
        },
      }),
    );

    await typeInto(controlFor(root, "EC member user ID"), OTHER_EC_MEMBER_ID);
    await submitForm(root);

    // A toast can be gone before the reader looks up; the card must say so
    // itself, and must not discard the identifier that was typed.
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("This application is not in EC review.");
    expect(controlFor(root, "EC member user ID").value).toBe(OTHER_EC_MEMBER_ID);
    expect(controlFor(root, "EC member user ID").getAttribute("aria-invalid")).toBeNull();
    expect(buttonNamed(root, "Record").disabled).toBe(false);
  });
});
