// @vitest-environment jsdom
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formCreateResponseSchema,
  formDetailResponseSchema,
  formSubmissionStatsResponseSchema,
  formSubmissionsResponseSchema,
  formsListResponseSchema,
} from "../../assets/shared/schemas/form-management";
import {
  EventFormResponses,
  FormManagementCreate,
  FormManagementDetail,
  FormManagementList,
} from "../../assets/ts/components/forms/management/FormManagement";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { isCurrentTab, tabs } from "./helpers/tabs";

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

function emptySubmissionsResponse(): Response {
  return new Response(
    JSON.stringify(
      formSubmissionsResponseSchema.parse({
        form: { id: "form-4", key: "member-feedback", title: "Member feedback", purpose: "feedback", placement: null },
        submissions: [],
        page: { limit: 25, offset: 0, total: 0, hasMore: false },
      }),
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function globalFormDetailResponse(): Response {
  return new Response(
    JSON.stringify(
      formDetailResponseSchema.parse({
        form: {
          id: "00000000-0000-4000-8000-000000000004",
          key: "member-feedback",
          scope_type: "global",
          scope_ref: null,
          purpose: "feedback",
          status: "active",
          title: "Member feedback",
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

function dialogButton(root: HTMLElement, label: string): HTMLButtonElement {
  const dialog = root.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("no confirm dialog is open");
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing dialog button: ${label}`);
  return button;
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

    expect(container.querySelector("form")).toBeNull();
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

  it("opens the tab named in a preset hash query instead of the default statistics tab", async () => {
    const previousHash = window.location.hash;
    window.location.hash = "#/forms/member-feedback?formTab=responses";
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            location.origin,
          );
          if (url.pathname.endsWith("/submissions/stats")) return emptyStatsResponse();
          if (url.pathname.endsWith("/submissions")) return emptySubmissionsResponse();
          return globalFormDetailResponse();
        }),
      );

      const container = mount(<FormManagementDetail formKey="member-feedback" canWrite={false} onBack={vi.fn()} />);
      await settle();

      const activeTab = tabs(container).find(isCurrentTab);
      expect(activeTab?.textContent).toBe("Responses");
    } finally {
      window.location.hash = previousHash;
    }
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

  it("archives or deletes a form only after the named confirmation is accepted", async () => {
    const requests: { method: string; url: URL }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        requests.push({ method, url });
        if (method === "DELETE") {
          return new Response(JSON.stringify({ action: "deleted", message: "Form deleted" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return url.pathname.endsWith("/submissions/stats") ? emptyStatsResponse() : globalFormDetailResponse();
      }),
    );
    const onBack = vi.fn();
    const notify = vi.fn();

    const container = mount(
      <>
        <ConfirmDialogHost />
        <FormManagementDetail formKey="member-feedback" canWrite onBack={onBack} notify={notify} />
      </>,
    );
    await settle();

    const removeButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Archive/Delete",
    );
    if (!removeButton) throw new Error("missing Archive/Delete button");
    void act(() => removeButton.click());

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('Archive or delete "Member feedback"?');
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);

    void act(() => dialogButton(container, "Archive or delete form").click());
    await settle();

    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        url: expect.objectContaining({ pathname: "/api/v1/forms/member-feedback" }),
      }),
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("keeps the form when the archive/delete confirmation is cancelled", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      return url.pathname.endsWith("/submissions/stats") ? emptyStatsResponse() : globalFormDetailResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    const onBack = vi.fn();

    const container = mount(
      <>
        <ConfirmDialogHost />
        <FormManagementDetail formKey="member-feedback" canWrite onBack={onBack} />
      </>,
    );
    await settle();

    const removeButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Archive/Delete",
    );
    if (!removeButton) throw new Error("missing Archive/Delete button");
    const callsBeforeCancel = fetchMock.mock.calls.length;
    void act(() => removeButton.click());
    void act(() => dialogButton(container, "Cancel").click());
    await settle();

    expect(fetchMock.mock.calls.length).toBe(callsBeforeCancel);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("states a failed load as a sentence in an alert region rather than an empty panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );

    const container = mount(<FormManagementDetail formKey="member-feedback" canWrite onBack={vi.fn()} />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("The service is temporarily unavailable. Try again in a moment.");
    // The transport phrasing never reaches the reader, and nothing pretends
    // the form loaded.
    expect(container.textContent).not.toContain("HTTP 503");
    expect(container.querySelector('[role="tab"]')).toBeNull();
  });

  it("wires each tab to the panel it controls, in both directions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        return url.pathname.endsWith("/submissions/stats") ? emptyStatsResponse() : globalFormDetailResponse();
      }),
    );

    const container = mount(<FormManagementDetail formKey="member-feedback" canWrite onBack={vi.fn()} />);
    await settle();

    const strip = container.querySelector('[role="tablist"]');
    expect(strip?.getAttribute("aria-label")).toBe("Member feedback sections");

    const selected = tabs(container).find(isCurrentTab);
    const panelId = selected?.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = [...container.querySelectorAll('[role="tabpanel"]')].find((element) => element.id === panelId);
    expect(panel).toBeTruthy();
    // And back the other way, so the panel is announced with the tab's name.
    expect(panel?.getAttribute("aria-labelledby")).toBe(selected?.id);

    // Exactly one tab is in the tab order; the arrows move within the strip.
    const inTabOrder = tabs(container).filter((tab) => tab.tabIndex === 0);
    expect(inTabOrder).toHaveLength(1);
  });

  it("names the forms table and makes the whole row a keyboard-reachable control that says which form it opens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => formListResponse()),
    );
    const onOpenForm = vi.fn();

    const container = mount(<FormManagementList canWrite={false} onOpenForm={onOpenForm} />);
    await settle();

    // A table with no caption is announced as "table"; this page can hold
    // several.
    expect(container.querySelector("caption")?.textContent).toBe("Configured forms");

    const row = container.querySelector("tbody tr");
    const action = row?.querySelector("button");
    expect(action?.textContent).toBe("Open Member feedback");
    // Not a click handler on the <tr>: a row is not focusable and takes no
    // Enter key.
    expect(row?.hasAttribute("onclick")).toBe(false);

    action!.click();
    expect(onOpenForm).toHaveBeenCalledWith("member-feedback");
  });

  it("names the response filter bar and every control in it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => formListResponse()),
    );

    const container = mount(<EventFormResponses eventSlug="pqc-2026" purpose="proposal_submission" />);
    await settle();

    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar?.getAttribute("aria-label")).toBe("Response filters");

    const statusFilter = toolbar?.querySelector("select");
    expect(statusFilter?.getAttribute("aria-label")).toBe("Submission status");
    expect([...statusFilter!.options].map((option) => option.value)).toEqual([
      "",
      "submitted",
      "accepted",
      "rejected",
      "withdrawn",
    ]);

    // Attendance is a registration-only vocabulary, so it is absent here.
    expect(toolbar?.querySelectorAll("select")).toHaveLength(1);
  });
});
