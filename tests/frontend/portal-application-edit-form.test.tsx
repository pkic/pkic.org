// @vitest-environment jsdom
/**
 * The staff correction form on a membership application.
 *
 * What is asserted here is what a visual review cannot see: that every control
 * is reachable through its own label's `for`/`id` pair, that one `disabled`
 * takes the whole group out of play, that a failed save is announced rather
 * than merely coloured, and that what the surface finally sends satisfies the
 * canonical request contract rather than a literal copy of itself.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applicationUpdateSchema } from "../../assets/shared/schemas/membership-application-management";
import type { MembershipCategoryCatalogEntry } from "../../assets/shared/schemas/membership-categories";
import {
  ApplicationEditForm,
  type ApplicationEditFormValue,
} from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationEditForm";
import { ApplicationDetailView } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationDetailView";
import { buttonNamed, buttonNames, controlFor, labelNames, typeInto } from "./helpers/labelled-control";

const APPLICATION_ID = "00000000-0000-4000-8000-000000000301";
const NOW = "2026-08-31T09:00:00.000Z";

function category(overrides: Partial<MembershipCategoryCatalogEntry> = {}): MembershipCategoryCatalogEntry {
  return {
    code: "F",
    label: "General Member",
    description: null,
    displayOrder: 60,
    isIndividual: false,
    isVoting: true,
    revision: 0,
    updatedAt: NOW,
    ...overrides,
  };
}

const CATEGORIES: MembershipCategoryCatalogEntry[] = [
  category(),
  category({ code: "H5", label: "Individual", displayOrder: 70, isIndividual: true }),
];

function formValue(overrides: Partial<ApplicationEditFormValue> = {}): ApplicationEditFormValue {
  return {
    applicantName: "Example Applicant",
    applicantEmail: "applicant@example.test",
    organizationName: "Example Organization",
    membershipCategory: "F",
    jobTitle: "Engineer",
    linkedin: "",
    organizationWebsite: "",
    aboutYourself: "",
    aboutOrganization: "",
    reason: "",
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

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

/** Renders the form with sensible defaults and returns the mounted root. */
function mountForm(props: Partial<Parameters<typeof ApplicationEditForm>[0]> = {}): HTMLElement {
  return mount(
    <ApplicationEditForm
      form={formValue()}
      categories={CATEGORIES}
      onChange={vi.fn()}
      disabled={false}
      error=""
      onSave={vi.fn()}
      onCancel={vi.fn()}
      saving={false}
      {...props}
    />,
  );
}

describe("membership-application edit form", () => {
  it("names every control through its own label, and marks the fields the contract requires", () => {
    const page = mountForm();

    expect(labelNames(page)).toEqual([
      "Applicant name",
      "Email",
      "Category",
      "Organization",
      "Role / Job title",
      "LinkedIn",
      "Organization website",
      "About yourself",
      "About organization",
      "Reason for joining",
    ]);

    // Resolved through the `for`/`id` pair itself, so the lookup fails exactly
    // when the labelling contract is broken.
    expect(controlFor(page, "Applicant name").value).toBe("Example Applicant");
    expect(controlFor(page, "Email").type).toBe("email");
    expect(controlFor<HTMLSelectElement>(page, "Category").value).toBe("F");
    expect(controlFor<HTMLTextAreaElement>(page, "Reason for joining").tagName).toBe("TEXTAREA");

    // The three fields PATCH /members/applications/:id cannot accept as empty
    // are the three the markup announces as required.
    const required = [...page.querySelectorAll<HTMLElement>("[required]")].map((control) => control.id);
    expect(required).toEqual([
      controlFor(page, "Applicant name").id,
      controlFor(page, "Email").id,
      controlFor<HTMLSelectElement>(page, "Category").id,
    ]);
    expect(page.textContent).toContain("(required)");
  });

  it("reports an edit through the updater rather than mutating the value it was given", async () => {
    const onChange = vi.fn();
    const page = mountForm({ onChange });

    await typeInto(controlFor(page, "Role / Job title"), "Principal Engineer");

    expect(onChange).toHaveBeenCalledTimes(1);
    const updater = onChange.mock.calls[0]?.[0] as (f: ApplicationEditFormValue) => ApplicationEditFormValue;
    const previous = formValue();
    expect(updater(previous)).toMatchObject({ jobTitle: "Principal Engineer", applicantName: "Example Applicant" });
    expect(previous.jobTitle).toBe("Engineer");
  });

  it("drops the organization field for an individual category, which stores no organization", () => {
    const page = mountForm({ form: formValue({ membershipCategory: "H5", organizationName: "" }) });

    expect(labelNames(page)).not.toContain("Organization");
    expect(labelNames(page)).toContain("Organization website");
  });

  it("takes every control out of play with one disabled group while a save is in flight", () => {
    const page = mountForm({ disabled: true, saving: true });

    const group = page.querySelector("fieldset");
    expect(group?.disabled).toBe(true);
    // A disabled fieldset disables its descendants, so no control can be typed
    // into while the request is outstanding. The state is inherited rather
    // than reflected onto each element, so `:disabled` is what says it.
    const controls = [...page.querySelectorAll("fieldset input, fieldset select, fieldset textarea")];
    expect(controls).toHaveLength(10);
    expect(controls.every((control) => control.matches(":disabled"))).toBe(true);

    const save = buttonNamed(page, "Saving…");
    expect(save.getAttribute("aria-busy")).toBe("true");
    // Loading, not disabled: a disabled control loses focus and throws the
    // reader out of the form they were in the middle of.
    expect(save.disabled).toBe(false);
    expect(buttonNamed(page, "Cancel").disabled).toBe(true);
  });

  it("announces a failed save as an alert, in English rather than transport phrasing", () => {
    const page = mountForm({ error: "HTTP 403" });

    const alert = page.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("You don't have access to this");
    expect(page.textContent).not.toContain("HTTP 403");
    // The edit survives the failure — a failed save is a retry, not a restart.
    expect(controlFor(page, "Applicant name").value).toBe("Example Applicant");
  });

  it("saves on submit, so the form can be completed from the keyboard, and cancels without saving", async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const page = mountForm({ onSave, onCancel });

    await act(() => {
      page.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    await act(() => buttonNamed(page, "Cancel").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("membership-application edit form, end to end", () => {
  const detail = {
    id: APPLICATION_ID,
    applicantEmail: "applicant@example.test",
    applicantName: "Example Applicant",
    organizationName: "Example Organization",
    membershipCategory: "F",
    membershipCategoryLabel: "General Member",
    stage: "ec_review" as const,
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
  };

  function stub(bodies: unknown[], failSave = false) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        if (url.pathname.endsWith("/documents")) {
          return json({ documents: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } });
        }
        if (method === "PATCH") {
          bodies.push(JSON.parse(String(init?.body)));
          if (failSave) {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
              status: 403,
              headers: { "content-type": "application/json" },
            });
          }
        }
        return json(detail);
      }),
    );
  }

  async function openEditor(): Promise<HTMLElement> {
    const page = mount(
      <ApplicationDetailView
        applicationId={APPLICATION_ID}
        categories={[category()]}
        canWrite
        canApprove={false}
        onBack={vi.fn()}
      />,
    );
    await settle();
    await act(() => buttonNamed(page, "Edit").click());
    return page;
  }

  it("sends an edit that satisfies the canonical PATCH contract", async () => {
    const bodies: unknown[] = [];
    stub(bodies);

    const page = await openEditor();
    await typeInto(controlFor(page, "Applicant name"), "Corrected Applicant");
    await act(() => {
      page.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(bodies).toHaveLength(1);
    // Checked against the shared contract, not against a literal copy of what
    // the component just sent.
    const parsed = applicationUpdateSchema.parse(bodies[0]);
    expect(parsed).toMatchObject({
      applicantName: "Corrected Applicant",
      applicantEmail: "applicant@example.test",
      organizationName: "Example Organization",
      membershipCategory: "F",
    });
    expect(parsed.answers).toEqual({
      job_title: null,
      linkedin: null,
      organization_website: null,
      about_yourself: null,
      about_organization: null,
      reason: null,
    });
    // A successful save closes the editor and returns to the summary.
    expect(buttonNames(page)).not.toContain("Save");
  });

  it("keeps the editor open and announces the refusal when the save is rejected", async () => {
    const bodies: unknown[] = [];
    stub(bodies, true);

    const page = await openEditor();
    await typeInto(controlFor(page, "Applicant name"), "Corrected Applicant");
    await act(() => {
      page.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(bodies).toHaveLength(1);
    const alert = [...page.querySelectorAll('[role="alert"]')].find((node) =>
      node.textContent?.includes("You don't have access to this"),
    );
    expect(alert).toBeDefined();
    expect(controlFor(page, "Applicant name").value).toBe("Corrected Applicant");
    expect(buttonNames(page)).toContain("Save");
  });
});
