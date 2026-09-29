// @vitest-environment jsdom
/**
 * The application summary staff read first, and the edit toggle on it.
 *
 * What is asserted here is what a visual review cannot see: that the card
 * names itself among the column of cards beside it, that every value is tied
 * to its own term now that the summary is a description list rather than an
 * unnamed two-column table, that a refused save is announced and keeps the
 * editor open, and that the one case where editing is impossible says so in
 * a sentence instead of offering a dead control.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MembershipApplicationDetail } from "../../assets/shared/schemas/membership-application-management";
import type { MembershipCategoryCatalogEntry } from "../../assets/shared/schemas/membership-categories";
import { ApplicationOverviewCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationOverviewCard";
import { buttonNamed, buttonNames, controlFor, labelNames, typeInto } from "./helpers/labelled-control";

const NOW = "2026-08-31T09:00:00.000Z";

const CATEGORIES: MembershipCategoryCatalogEntry[] = [
  {
    code: "F",
    label: "General Member",
    description: null,
    displayOrder: 60,
    isIndividual: false,
    requiresUniversityEmail: false,
    isVoting: true,
    active: true,
    workflowVersionId: null,
    revision: 0,
    updatedAt: NOW,
  },
];

function detail(overrides: Partial<MembershipApplicationDetail> = {}): MembershipApplicationDetail {
  return {
    id: "00000000-0000-4000-8000-000000000301",
    applicantEmail: "applicant@example.test",
    applicantName: "Example Applicant",
    organizationName: "Example Organization",
    membershipCategory: "F",
    membershipCategoryLabel: "General Member",
    currentRequirement: "Review the application form",
    stage: "processing",
    onHoldSubtype: null,
    assignedToUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    stageEnteredAt: NOW,
    answers: {},
    requestedWorkingGroups: [],
    events: [],
    communications: [],
    ...overrides,
  };
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

/** The `dd` that answers the term reading `term`. */
function valueOf(root: ParentNode, term: string): HTMLElement {
  const dt = [...root.querySelectorAll("dt")].find((candidate) => candidate.textContent === term);
  if (!dt) throw new Error(`no term reads "${term}"`);
  const dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== "DD") throw new Error(`term "${term}" is followed by no value`);
  return dd as HTMLElement;
}

function termNames(root: ParentNode): string[] {
  return [...root.querySelectorAll("dt")].map((dt) => dt.textContent ?? "");
}

function mountCard(props: Partial<Parameters<typeof ApplicationOverviewCard>[0]> = {}): HTMLElement {
  return mount(
    <ApplicationOverviewCard
      detail={detail()}
      categories={CATEGORIES}
      onSave={vi.fn(async () => undefined)}
      {...props}
    />,
  );
}

describe("membership application overview card", () => {
  it("names itself as a region and pairs every value with its own term", () => {
    const page = mountCard();

    const region = page.querySelector("section");
    expect(region?.getAttribute("aria-label")).toBe("Application");
    expect(page.querySelector("h3")?.textContent).toBe("Application");

    expect(termNames(page)).toEqual([
      "Applicant name",
      "Email",
      "Organization",
      "Category",
      "Stage",
      "Stage entered",
      "Submitted",
    ]);

    // The pairs are direct children of the list — a wrapper between them would
    // take both out of the two-column grid.
    const list = page.querySelector("dl")!;
    expect(list.querySelectorAll(":scope > dt")).toHaveLength(7);
    expect(list.querySelectorAll(":scope > dd")).toHaveLength(7);

    expect(valueOf(page, "Applicant name").textContent).toBe("Example Applicant");
    expect(valueOf(page, "Email").textContent).toBe("applicant@example.test");
    expect(valueOf(page, "Organization").textContent).toBe("Example Organization");
    expect(valueOf(page, "Category").textContent).toContain("General Member");
    expect(valueOf(page, "Category").textContent).toContain("(F)");
    // The stage is a pill whose word says the stage, so the tone is not the
    // only thing carrying it.
    expect(valueOf(page, "Stage").textContent).toBe("Processing");

    // It is a list, not a grid: as an unnamed table it was announced as one.
    expect(page.querySelector("table")).toBeNull();
  });

  it("says an applicant with no organization is an individual, in words", () => {
    const page = mountCard({ detail: detail({ organizationName: null }) });

    expect(valueOf(page, "Organization").textContent).toBe("Individual — no organization");
  });

  it("shows the on-hold reason only when the application is on hold", () => {
    expect(termNames(mountCard())).not.toContain("On-hold reason");

    void act(() => render(null, container!));
    container!.remove();
    container = null;

    const page = mountCard({ detail: detail({ stage: "on_hold", onHoldSubtype: "request_information" }) });
    expect(termNames(page)).toContain("On-hold reason");
    expect(valueOf(page, "On-hold reason").textContent).toBe("request_information");
  });

  it("carries no edit control of its own: editing is the record's command, never open by default", () => {
    const page = mountCard();

    expect(buttonNames(page)).not.toContain("Edit");
    expect(page.querySelector("dl")).not.toBeNull();
  });

  it("shows the editor when the record asks for it and hands cancelling back without saving", async () => {
    const onSave = vi.fn(async () => undefined);
    const onEditingChange = vi.fn();
    const page = mountCard({ onSave, editing: true, onEditingChange });
    await settle();

    expect(page.querySelector("dl")).toBeNull();
    expect(labelNames(page)).toContain("Applicant name");
    expect(controlFor(page, "Applicant name").value).toBe("Example Applicant");

    await act(() => buttonNamed(page, "Cancel").click());
    expect(onSave).not.toHaveBeenCalled();
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });

  it("keeps the editor open and announces the refusal when the save is rejected", async () => {
    const page = mountCard({
      editing: true,
      onSave: vi.fn(async () => {
        throw new Error("HTTP 403");
      }),
    });
    await settle();

    await typeInto(controlFor(page, "Applicant name"), "Corrected Applicant");
    await act(async () => {
      page.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const alert = [...page.querySelectorAll('[role="alert"]')].find((node) =>
      node.textContent?.includes("You don't have access to this"),
    );
    expect(alert).toBeDefined();
    // A failed save is a retry, not a restart.
    expect(controlFor(page, "Applicant name").value).toBe("Corrected Applicant");
    expect(buttonNames(page)).toContain("Save");
  });
});
