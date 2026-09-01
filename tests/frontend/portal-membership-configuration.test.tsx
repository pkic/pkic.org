// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { membershipApplicationFormDefinitionUpdateSchema } from "../../assets/shared/schemas/membership-application-form";
import { membershipCategoryUpdateSchema } from "../../assets/shared/schemas/membership-categories";
import { membershipSettingsUpdateSchema } from "../../assets/shared/schemas/membership-settings";
import { MembershipConfiguration } from "../../assets/ts/member-flows/portal/sections/MembershipConfiguration";
import { buttonNamed, controlFor, typeInto } from "./helpers/labelled-control";

const NOW = "2026-08-27T12:00:00.000Z";
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

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(canWrite: boolean): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(<MembershipConfiguration canWrite={canWrite} />, container!));
  return container;
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("portal membership configuration", () => {
  it("uses canonical membership APIs and sends revision-guarded settings and category updates", async () => {
    const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          writes.push({ path: url.pathname, body });
          if (url.pathname.endsWith("/applications/form/definition")) {
            return json({ ...applicationForm, form: { ...applicationForm.form, ...body, updatedAt: NOW } });
          }
          if (url.pathname.endsWith("/H1")) {
            return json({ category: { ...category, ...body, revision: 5, updatedAt: NOW } });
          }
          return json({ ...settings, ...body, revision: 4, updatedAt: NOW });
        }
        if (url.pathname === "/api/v1/membership/settings") return json(settings);
        if (url.pathname === "/api/v1/membership/categories") return json({ categories: [category] });
        if (url.pathname.endsWith("/applications/form/definition")) return json(applicationForm);
        return new Response(null, { status: 404 });
      }),
    );

    const page = mount(true);
    await settle();
    expect(page.textContent).toContain("Application workflow");
    expect(page.textContent).toContain("Membership application form");
    expect(page.textContent).toContain("Category H1");
    expect(page.textContent).toContain("Organization");

    await typeInto(controlFor(page, "Label"), "Government PKI participants");
    await act(async () => buttonNamed(page, "Save category H1").click());
    await settle();

    await act(async () => buttonNamed(page, "Save workflow settings").click());
    await settle();

    // Both bodies are asserted through the canonical request schemas, so a
    // shape the endpoint would reject fails here rather than in production.
    const categoryWrite = writes.find((write) => write.path === "/api/v1/membership/categories/H1");
    expect(membershipCategoryUpdateSchema.parse(categoryWrite?.body)).toEqual({
      expectedRevision: 4,
      label: "Government PKI participants",
      description: "Existing description",
      displayOrder: 80,
      isVoting: false,
    });

    const settingsWrite = writes.find((write) => write.path.endsWith("/membership/settings"));
    expect(membershipSettingsUpdateSchema.parse(settingsWrite?.body).expectedRevision).toBe(3);
    expect(writes.every((write) => write.path.startsWith("/api/v1/membership/"))).toBe(true);
    expect(writes.some((write) => write.path.startsWith("/api/v1/system/"))).toBe(false);
  });

  it("renders the same data read-only without mutation controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === "/api/v1/membership/settings") return json(settings);
        if (url.pathname === "/api/v1/membership/categories") return json({ categories: [category] });
        if (url.pathname.endsWith("/applications/form/definition")) return json(applicationForm);
        return new Response(null, { status: 404 });
      }),
    );

    const page = mount(false);
    await settle();
    await settle();
    expect(page.querySelectorAll("button")).toHaveLength(0);
    expect(page.textContent).toContain("Membership application");
    expect(page.textContent).toContain("Tell us about your organization.");
    expect(page.textContent).toContain("Reason for joining");
    expect(page.textContent).toContain("Required");
    expect(page.textContent).toContain("Required policy acknowledgements");
    expect([...page.querySelectorAll("input, textarea")].every((field) => (field as HTMLInputElement).disabled)).toBe(
      true,
    );
  });

  it("saves an edited application field through only the canonical definition route", async () => {
    const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
        requests.push({ path: url.pathname, method, body });
        if (url.pathname === "/api/v1/membership/settings") return json(settings);
        if (url.pathname === "/api/v1/membership/categories") return json({ categories: [category] });
        if (url.pathname.endsWith("/applications/form/definition") && method === "GET") return json(applicationForm);
        if (url.pathname.endsWith("/applications/form/definition") && method === "PATCH") {
          return json(applicationForm);
        }
        return new Response(null, { status: 404 });
      }),
    );

    const page = mount(true);
    await settle();
    await settle();
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
    expect(mutation?.path).toBe("/api/v1/members/applications/form/definition");
    const update = membershipApplicationFormDefinitionUpdateSchema.parse(mutation?.body);
    expect(update.expectedUpdatedAt).toBe(NOW);
    expect(update.fields).toMatchObject([{ key: "interest", label: "How will you contribute?" }]);
    // The workflow-owned consent fields are never resubmitted as editable ones.
    expect(update.fields?.map((field) => field.key)).not.toContain("agrees_bylaws");
    expect(requests.some((request) => request.path.startsWith("/api/v1/admin/forms"))).toBe(false);
  });

  it("reports a failed load through the shared error alert instead of an empty page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    const page = mount(true);
    await settle();
    await settle();

    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Something went wrong on our side.");
    // Nothing half-loaded renders behind the failure.
    expect(page.textContent).not.toContain("Application workflow");
    expect(page.querySelectorAll("form")).toHaveLength(0);
  });

  it("keeps the rest of the screen usable when only the application form fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === "/api/v1/membership/settings") return json(settings);
        if (url.pathname === "/api/v1/membership/categories") return json({ categories: [category] });
        return new Response(null, { status: 503 });
      }),
    );

    const page = mount(true);
    await settle();
    await settle();

    const formRegion = page.querySelector<HTMLElement>('section[aria-label="Membership application form"]');
    expect(formRegion).not.toBeNull();
    expect(formRegion!.querySelector('[role="alert"]')?.textContent).toContain(
      "The service is temporarily unavailable.",
    );
    expect(page.textContent).toContain("Application workflow");
    expect(page.textContent).toContain("Category H1");
  });

  it("labels every control it renders and names the regions around them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === "/api/v1/membership/settings") return json(settings);
        if (url.pathname === "/api/v1/membership/categories") return json({ categories: [category] });
        if (url.pathname.endsWith("/applications/form/definition")) return json(applicationForm);
        return new Response(null, { status: 404 });
      }),
    );

    const page = mount(true);
    await settle();
    await settle();

    // Each labelled control is reachable through a real `for`/`id` pair, and
    // the deadline fields describe their own bounds.
    const window = controlFor(page, "Consultation window (days)");
    expect(page.querySelector(`label[for="${window.id}"]`)?.textContent).toBe("Consultation window (days)");
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

    // The mandatory consent fields are a named list, and "Required" is a word
    // rather than a colour.
    const policyList = page.querySelector('ul[aria-label="Required policy acknowledgements"]');
    expect(policyList?.querySelectorAll("li")).toHaveLength(4);
    expect(policyList?.textContent).toContain("Required");
  });
});
