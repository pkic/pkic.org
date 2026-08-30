// @vitest-environment jsdom
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formCreateResponseSchema,
  formDetailResponseSchema,
  formSubmissionStatsResponseSchema,
  formsListResponseSchema,
} from "../../assets/shared/schemas/form-management";
import {
  EventFormResponses,
  FormManagementCreate,
  FormManagementDetail,
  FormManagementList,
} from "../../assets/ts/components/forms/management/FormManagement";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function formListResponse(): Response {
  return new Response(
    JSON.stringify(
      formsListResponseSchema.parse({
        forms: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            key: "member-feedback",
            scope_type: "global",
            scope_ref: null,
            purpose: "feedback",
            status: "active",
            title: "Member feedback",
            description: null,
            created_at: "2026-08-29T10:00:00.000Z",
            updated_at: "2026-08-29T10:00:00.000Z",
            event_slug: null,
            event_name: null,
            field_count: 2,
            placement_count: 1,
            submission_count: 4,
          },
        ],
        page: { limit: 25, offset: 0, total: 1, hasMore: false },
      }),
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function communityFormDetailResponse(): Response {
  return new Response(
    JSON.stringify(
      formDetailResponseSchema.parse({
        form: {
          id: "00000000-0000-4000-8000-000000000002",
          key: "community-survey",
          scope_type: "community",
          scope_ref: "00000000-0000-4000-8000-000000000003",
          purpose: "survey",
          status: "active",
          title: "Community survey",
          description: null,
          created_at: "2026-08-29T10:00:00.000Z",
          updated_at: "2026-08-29T10:00:00.000Z",
        },
        fields: [],
      }),
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function emptyStatsResponse(): Response {
  return new Response(
    JSON.stringify(
      formSubmissionStatsResponseSchema.parse({
        form: {
          id: "form-2",
          key: "community-survey",
          title: "Community survey",
          purpose: "survey",
          placement: null,
        },
        total: 0,
        stats: [],
      }),
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal form management", () => {
  it("uses the canonical forms endpoint and keeps a reader read-only", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return formListResponse();
      }),
    );

    const container = mount(<FormManagementList canWrite={false} onOpenForm={vi.fn()} />);
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/api/v1/forms");
    expect(requests.some((request) => request.pathname.startsWith("/api/v1/admin/forms"))).toBe(false);
    expect(container.textContent).toContain("Member feedback");
    expect(container.textContent).not.toContain("New form");
    expect(container.textContent).not.toContain("Archive/Delete");
  });

  it("shows authoring controls only to a form writer, and New form hands off to the caller instead of layering a table below it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => formListResponse()),
    );
    const onCreateNew = vi.fn();

    const container = mount(<FormManagementList canWrite onOpenForm={vi.fn()} onCreateNew={onCreateNew} />);
    await settle();

    expect(container.textContent).toContain("New form");
    const newFormButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "New form",
    );
    newFormButton!.click();
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it("does not offer global mutations for a community-owned form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        return url.pathname.endsWith("/submissions/stats") ? emptyStatsResponse() : communityFormDetailResponse();
      }),
    );

    const container = mount(<FormManagementDetail formKey="community-survey" canWrite onBack={vi.fn()} />);
    await settle();

    expect(container.textContent).toContain("Community survey");
    expect(container.textContent).not.toContain("Edit");
    expect(container.textContent).not.toContain("Archive/Delete");
  });

  it("uses the event-owned catalogue rather than the global form resource for event responses", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return formListResponse();
      }),
    );

    mount(<EventFormResponses eventSlug="pqc-2026" purpose="proposal_submission" />);
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/api/v1/events/pqc-2026/forms");
    expect(requests[0]?.searchParams.get("purpose")).toBe("proposal_submission");
  });

  it("shows only the creation editor, with no forms table, and cancel hands control back without saving", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onCancel = vi.fn();

    const container = mount(<FormManagementCreate onCreated={vi.fn()} onCancel={onCancel} />);
    await settle();

    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).not.toContain("No forms configured");
    expect(fetchMock).not.toHaveBeenCalled();

    const backButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "← All forms",
    );
    expect(backButton).toBeTruthy();
    backButton!.click();
    expect(onCancel).toHaveBeenCalledTimes(1);

    const editorCancel = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel",
    );
    editorCancel!.click();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("hands the created form's key to the caller on success, so the flow can navigate straight to its detail", async () => {
    const requests: { method: string; url: URL; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({
          method: init?.method ?? "GET",
          url,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return new Response(
          JSON.stringify(
            formCreateResponseSchema.parse({
              success: true,
              formId: "00000000-0000-4000-8000-000000000009",
              placementId: "00000000-0000-4000-8000-000000000010",
              key: "new-member-form",
            }),
          ),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const onCreated = vi.fn();

    const container = mount(<FormManagementCreate onCreated={onCreated} onCancel={vi.fn()} />);
    await settle();

    function fieldFor(labelText: string): HTMLInputElement {
      const label = Array.from(container.querySelectorAll("label")).find((el) => el.textContent === labelText)!;
      return container.querySelector(`#${label.getAttribute("for")}`) as HTMLInputElement;
    }

    // These are controlled inputs backed by useState, read from that state
    // (not the DOM) on submit — each edit must flush through `act` so the
    // form's submit handler closes over the updated draft before it's used.
    void act(() => {
      const keyInput = fieldFor("Key");
      keyInput.value = "new-member-form";
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    void act(() => {
      const titleInput = fieldFor("Title");
      titleInput.value = "New member form";
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // The editor always renders one field row and requires it to be filled
    // in (its "remove" control is disabled at the last row), so a valid
    // submission needs this field's key/label too, matching how
    // tests/e2e/portal-forms.spec.ts drives the same editor.
    void act(() => {
      const fieldKeyInput = container.querySelector(
        'input[aria-label="Field key (lowercase, letters, digits, underscores)"]',
      ) as HTMLInputElement;
      fieldKeyInput.value = "feedback";
      fieldKeyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    void act(() => {
      const fieldLabelInput = container.querySelector('input[aria-label="Field label"]') as HTMLInputElement;
      fieldLabelInput.value = "Feedback";
      fieldLabelInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      (container.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const created = requests.find((request) => request.method === "POST");
    expect(created?.url.pathname).toBe("/api/v1/forms");
    expect(created?.body).toMatchObject({ key: "new-member-form", title: "New member form" });
    expect(onCreated).toHaveBeenCalledWith("new-member-form");
  });
});
