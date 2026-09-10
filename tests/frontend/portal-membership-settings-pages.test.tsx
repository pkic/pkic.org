// @vitest-environment jsdom
/**
 * The three pages that used to be one "Membership Settings" screen (#40).
 *
 * The behaviour asserted here is the behaviour that screen had — canonical
 * membership APIs, revision-guarded writes, a read-only rendering with no
 * controls, and the paragraph that answers issue #16 — but each page now
 * carries only its own subject, heads itself, and loads only what it shows.
 * A page that fetched all three subjects to render one of them is what made
 * a failure in any of them a failure of the whole screen.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { membershipApplicationFormDefinitionUpdateSchema } from "../../assets/shared/schemas/membership-application-form";
import { membershipCategoryUpdateSchema } from "../../assets/shared/schemas/membership-categories";
import { membershipSettingsUpdateSchema } from "../../assets/shared/schemas/membership-settings";
import { ApplicationWorkflow } from "../../assets/ts/member-flows/portal/sections/membership-settings/ApplicationWorkflow";
import { MembershipApplicationForm } from "../../assets/ts/member-flows/portal/sections/membership-settings/MembershipApplicationForm";
import { MembershipCategories } from "../../assets/ts/member-flows/portal/sections/membership-settings/MembershipCategories";
import { beginRecordEdit } from "./helpers/record-edit";
import { buttonNamed, controlFor, typeInto } from "./helpers/labelled-control";
import { openQuestion } from "./helpers/form-editor";

const NOW = "2026-08-27T12:00:00.000Z";
const SETTINGS_API = "/api/v1/membership/settings";
const CATEGORIES_API = "/api/v1/membership/categories";
const FORM_DEFINITION_API = "/api/v1/members/applications/form/definition";

const settings = {
  consultationWindowDays: 7,
  ecReviewWindowDays: 7,
  onHoldResponseDeadlineDays: 7,
  consultationEmailRecipients: "consultation@example.test",
  ecEmailRecipients: "ec@example.test",
  ccApplicantEmails: "members@example.test",
  autoReminderOnHolds: true,
  revision: 3,
  updatedAt: NOW,
};
const category = {
  code: "H1",
  label: "Government entities",
  description: "Existing description",
  displayOrder: 80,
  isIndividual: false,
  isVoting: false,
  revision: 4,
  updatedAt: NOW,
};
const applicationForm = {
  form: {
    id: "10000000-0000-4000-8000-000000000001",
    key: "membership-application",
    title: "Membership application",
    description: "Tell us about your organization.",
    status: "active",
    purpose: "application",
    updatedAt: NOW,
  },
  fields: [
    {
      id: "10000000-0000-4000-8000-000000000002",
      key: "interest",
      label: "Reason for joining",
      fieldType: "textarea",
      required: true,
      sortOrder: 10,
      options: [],
      optionSource: null,
      validation: {},
      updatedAt: NOW,
      archivedAt: null,
    },
  ],
  policyFields: ["agrees_bylaws", "agrees_code_of_conduct", "agrees_ipr_policy", "warranted_authority"].map(
    (key, index) => ({
      id: `10000000-0000-4000-8000-00000000000${index + 3}`,
      key,
      label: `Policy ${index + 1}`,
      fieldType: "boolean",
      required: true,
      sortOrder: (index + 2) * 10,
      options: [],
      optionSource: null,
      validation: { requireTrue: true },
      updatedAt: NOW,
      archivedAt: null,
    }),
  ),
};

let container: HTMLElement | null = null;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

/** The requests each mounted page made, as `METHOD /path` with parsed bodies. */
interface CapturedRequest {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}

function stubApi(handler: (url: URL, init: RequestInit | undefined) => Response | null): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      captured.push({
        path: url.pathname,
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      });
      return handler(url, init) ?? new Response(null, { status: 404 });
    }),
  );
  return captured;
}

function mount(node: preact.ComponentChildren): HTMLElement {
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
  vi.unstubAllGlobals();
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("application workflow page", () => {
  it("heads itself and reads only the settings it shows", async () => {
    const requests = stubApi((url) => (url.pathname === SETTINGS_API ? json(settings) : null));

    const page = mount(<ApplicationWorkflow canWrite />);
    await settle();

    expect(page.querySelector("h2")?.textContent).toBe("Application workflow");
    // The categories and the application form are other pages, so this one
    // does not fetch them to render its own form.
    expect(requests.map((request) => request.path)).toEqual([SETTINGS_API]);
    expect(page.textContent).not.toContain("Category H1");
    expect(page.textContent).not.toContain("Required policy acknowledgements");
  });

  it("sends a revision-guarded update through the canonical membership route", async () => {
    const requests = stubApi((url, init) => {
      if (url.pathname !== SETTINGS_API) return null;
      if (init?.method === "PATCH") {
        return json({ ...settings, ...JSON.parse(String(init.body)), revision: 4, updatedAt: NOW });
      }
      return json(settings);
    });

    const page = mount(<ApplicationWorkflow canWrite />);
    await settle();
    await beginRecordEdit(page, "Workflow settings actions");
    await act(async () => buttonNamed(page, "Save workflow settings").click());
    await settle();

    // The body is asserted through the canonical request schema, so a shape
    // the endpoint would reject fails here rather than in production.
    const write = requests.find((request) => request.method === "PATCH");
    expect(write?.path).toBe(SETTINGS_API);
    expect(membershipSettingsUpdateSchema.parse(write?.body).expectedRevision).toBe(3);
    expect(requests.some((request) => request.path.startsWith("/api/v1/system/"))).toBe(false);
  });

  it("labels every control it renders, and the deadline fields state their own bounds", async () => {
    stubApi((url) => (url.pathname === SETTINGS_API ? json(settings) : null));

    const page = mount(<ApplicationWorkflow canWrite />);
    await settle();

    await beginRecordEdit(page, "Workflow settings actions");
    const window = controlFor(page, "Consultation window (days)");
    expect(page.querySelector(`label[for="${window.id}"]`)?.textContent).toContain("Consultation window (days)");
    const describedBy = window.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(page.querySelector(`#${describedBy!}`)?.textContent).toBe("Between 1 and 60 days.");

    // A checkbox needs all three parts, or it renders as an operating-system
    // default control.
    const reminder = Array.from(page.querySelectorAll("label.pk-check")).find((label) =>
      label.textContent?.startsWith("Send automatic reminders"),
    );
    expect(reminder?.querySelector("input.pk-check__input")?.getAttribute("type")).toBe("checkbox");
    expect(reminder?.querySelector("span.pk-check__label")).not.toBeNull();
  });

  it("renders read-only without mutation controls", async () => {
    stubApi((url) => (url.pathname === SETTINGS_API ? json(settings) : null));

    const page = mount(<ApplicationWorkflow canWrite={false} />);
    await settle();

    expect(page.querySelectorAll("button")).toHaveLength(0);
    expect([...page.querySelectorAll("input, textarea")].every((field) => (field as HTMLInputElement).disabled)).toBe(
      true,
    );
  });

  it("reports a failed load through the shared error alert, under a heading that still says where you are", async () => {
    stubApi(() => new Response(null, { status: 500 }));

    const page = mount(<ApplicationWorkflow canWrite />);
    await settle();

    expect(page.querySelector('[role="alert"]')?.textContent).toContain("Something went wrong on our side.");
    // The page still names itself; a failure is content, not a blank screen.
    expect(page.querySelector("h2")?.textContent).toBe("Application workflow");
    expect(page.querySelectorAll("form")).toHaveLength(0);
  });
});

describe("membership application form page", () => {
  it("heads itself and reads only the form definition", async () => {
    const requests = stubApi((url) => (url.pathname === FORM_DEFINITION_API ? json(applicationForm) : null));

    const page = mount(<MembershipApplicationForm canWrite />);
    await settle();
    await settle();

    expect(page.querySelector("h2")?.textContent).toBe("Membership application form");
    expect(requests.map((request) => request.path)).toEqual([FORM_DEFINITION_API]);
  });

  it("saves an edited field through only the canonical definition route", async () => {
    const requests = stubApi((url) => (url.pathname === FORM_DEFINITION_API ? json(applicationForm) : null));

    const page = mount(<MembershipApplicationForm canWrite />);
    await settle();
    await settle();
    await act(async () =>
      page.querySelector<HTMLButtonElement>('button[aria-label="Application form actions"]')!.click(),
    );
    await act(async () => buttonNamed(page, "Edit form").click());
    openQuestion(page, "Reason for joining");
    const label = [...page.querySelectorAll("input")].find(
      (field) => (field as HTMLInputElement).value === "Reason for joining",
    ) as HTMLInputElement;
    await act(() => {
      label.value = "How will you contribute?";
      label.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...page.querySelectorAll("button")].find((button) => button.textContent === "Save form")!;
    await act(async () => save.click());
    await settle();

    const mutation = requests.find((request) => request.method === "PATCH");
    expect(mutation?.path).toBe(FORM_DEFINITION_API);
    const update = membershipApplicationFormDefinitionUpdateSchema.parse(mutation?.body);
    expect(update.expectedUpdatedAt).toBe(NOW);
    expect(update.fields).toMatchObject([{ key: "interest", label: "How will you contribute?" }]);
    // The workflow-owned consent fields are never resubmitted as editable ones.
    expect(update.fields?.map((field) => field.key)).not.toContain("agrees_bylaws");
    expect(requests.some((request) => request.path.startsWith("/api/v1/admin/forms"))).toBe(false);
  });

  it("names the mandatory consent fields as a list, with Required as a word", async () => {
    stubApi((url) => (url.pathname === FORM_DEFINITION_API ? json(applicationForm) : null));

    const page = mount(<MembershipApplicationForm canWrite />);
    await settle();
    await settle();

    const policyList = page.querySelector('ul[aria-label="Required policy acknowledgements"]');
    expect(policyList?.querySelectorAll("li")).toHaveLength(4);
    expect(policyList?.textContent).toContain("Required");
  });

  it("renders the definition read-only without mutation controls", async () => {
    stubApi((url) => (url.pathname === FORM_DEFINITION_API ? json(applicationForm) : null));

    const page = mount(<MembershipApplicationForm canWrite={false} />);
    await settle();
    await settle();

    expect(page.querySelectorAll("button")).toHaveLength(0);
    expect(page.textContent).toContain("Membership application");
    expect(page.textContent).toContain("Tell us about your organization.");
    expect(page.textContent).toContain("Reason for joining");
  });

  it("reports a failed load inside the page rather than blanking it", async () => {
    stubApi(() => new Response(null, { status: 503 }));

    const page = mount(<MembershipApplicationForm canWrite />);
    await settle();
    await settle();

    const region = page.querySelector<HTMLElement>('section[aria-label="Membership application form"]');
    expect(region).not.toBeNull();
    expect(region!.querySelector('[role="alert"]')?.textContent).toContain("The service is temporarily unavailable.");
    expect(page.querySelector("h2")?.textContent).toBe("Membership application form");
  });
});

describe("membership categories page", () => {
  it("heads itself and reads only the catalog", async () => {
    const requests = stubApi((url) => (url.pathname === CATEGORIES_API ? json({ categories: [category] }) : null));

    const page = mount(<MembershipCategories canWrite />);
    await settle();

    expect(page.querySelector("h2")?.textContent).toBe("Membership categories");
    expect(requests.map((request) => request.path)).toEqual([CATEGORIES_API]);
    expect(page.textContent).toContain(`${category.label} (H1)`);
    expect(page.textContent).toContain("Organization");
  });

  it("sends a revision-guarded category update through the canonical membership route", async () => {
    const requests = stubApi((url, init) => {
      if (url.pathname === CATEGORIES_API) return json({ categories: [category] });
      if (url.pathname === `${CATEGORIES_API}/H1` && init?.method === "PATCH") {
        return json({ category: { ...category, ...JSON.parse(String(init.body)), revision: 5, updatedAt: NOW } });
      }
      return null;
    });

    const page = mount(<MembershipCategories canWrite />);
    await settle();
    await beginRecordEdit(page, "Category H1 actions");
    await typeInto(controlFor(page, "Label"), "Government PKI participants");
    await act(async () => buttonNamed(page, "Save category H1").click());
    await settle();

    const write = requests.find((request) => request.method === "PATCH");
    expect(write?.path).toBe(`${CATEGORIES_API}/H1`);
    expect(membershipCategoryUpdateSchema.parse(write?.body)).toEqual({
      expectedRevision: 4,
      label: "Government PKI participants",
      description: "Existing description",
      displayOrder: 80,
      isVoting: false,
    });
    expect(requests.every((request) => request.path.startsWith("/api/v1/membership/"))).toBe(true);
  });

  it("says where a new membership category comes from, since it cannot come from here", async () => {
    stubApi((url) => (url.pathname === CATEGORIES_API ? json({ categories: [category] }) : null));

    const page = mount(<MembershipCategories canWrite />);
    await settle();

    /*
     * Issue #16 was somebody looking for the "add a category" control and
     * finding neither one nor an explanation. The page used to say the codes
     * "cannot be changed here", which answers where not to look without
     * saying whether the thing is possible at all — so the question came to
     * the tracker instead.
     */
    expect(page.textContent).toContain("follows from the bylaws");
    expect(page.textContent).toContain("ships with a release");
    // And it still says what staff genuinely own on this page.
    expect(page.textContent).toContain("voting rights");
  });

  it("renders the catalog read-only without mutation controls", async () => {
    stubApi((url) => (url.pathname === CATEGORIES_API ? json({ categories: [category] }) : null));

    const page = mount(<MembershipCategories canWrite={false} />);
    await settle();

    expect(page.querySelectorAll("button")).toHaveLength(0);
    expect([...page.querySelectorAll("input, textarea")].every((field) => (field as HTMLInputElement).disabled)).toBe(
      true,
    );
  });

  it("reports a failed load through the shared error alert", async () => {
    stubApi(() => new Response(null, { status: 500 }));

    const page = mount(<MembershipCategories canWrite />);
    await settle();

    expect(page.querySelector('[role="alert"]')?.textContent).toContain("Something went wrong on our side.");
    expect(page.querySelectorAll("form")).toHaveLength(0);
  });
});
