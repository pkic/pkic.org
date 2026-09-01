// @vitest-environment jsdom
/**
 * The email-template catalog after its move onto the design system.
 *
 * The Bootstrap version hand-wrote every control with `form-label` +
 * `form-control-sm` and hard-coded ids, drew the create form as a `card`, and
 * signaled a taken key with `is-invalid` plus a red `invalid-feedback` div.
 * These assert what replaced them: Field-bound labels, `aria-invalid` and
 * `aria-describedby` on the control itself, and a rejected create that says
 * why instead of failing silently.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emailTemplateVersionSchema } from "../../assets/shared/schemas/email-templates";
import { EmailTemplates } from "../../assets/ts/member-flows/portal/sections/email-templates/EmailTemplates";

let container: HTMLDivElement | null = null;
let toastArea: HTMLDivElement | null = null;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(node: ComponentChild): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

/** `useId` emits ids a CSS selector would have to escape, and jsdom has no `CSS.escape`. */
function byId(root: HTMLElement, id: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>("[id]")].find((element) => element.id === id) ?? null;
}

function fieldLabels(root: HTMLElement): HTMLLabelElement[] {
  return [...root.querySelectorAll<HTMLLabelElement>("label.pk-field__label")];
}

/** The control a Field's label points at — the only binding the reader has. */
function labelled<T extends HTMLElement>(root: HTMLElement, text: string): T {
  const label = fieldLabels(root).find((candidate) => (candidate.textContent ?? "").startsWith(text));
  expect(label, `no field labelled "${text}"`).toBeDefined();
  const control = byId(root, label!.htmlFor);
  expect(control, `label "${text}" points at nothing`).not.toBeNull();
  return control as T;
}

async function typeInto(control: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  control.value = value;
  await act(() => {
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "") === label);
  expect(found, `no button labelled "${label}"`).toBeDefined();
  return found!;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  toastArea?.remove();
  toastArea = null;
  vi.unstubAllGlobals();
});

describe("portal email templates", () => {
  it("lets a writer create a template without loading catalog or version history", async () => {
    const templateKey = "write_only_template";
    const requests: Array<{ url: URL; method: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        if (url.pathname === `/api/v1/email/templates/${templateKey}/versions`) {
          return json({
            success: true,
            version: {
              id: "version-write-only",
              template_key: templateKey,
              version: 1,
              subject_template: null,
              body: "Write-only template body",
              content_type: "markdown",
              r2_object_key: null,
              checksum_sha256: "c".repeat(64),
              status: "draft",
              created_by_user_id: "user-1",
              created_at: "2026-08-28T12:00:00.000Z",
              message_type: "transactional",
            },
          });
        }
        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`);
      }),
    );

    mount(<EmailTemplates canRead={false} canWrite />);
    await settle();
    expect(requests).toEqual([]);

    // Every label in the form names a control that exists; nothing is a
    // floating caption the way a bare `form-label` was.
    const labels = fieldLabels(container!);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(byId(container!, label.htmlFor), `label "${label.textContent ?? ""}" points at nothing`).not.toBeNull();
    }

    const keyInput = labelled<HTMLInputElement>(container!, "Template key");
    const bodyInput = labelled<HTMLTextAreaElement>(container!, "Body");
    // The asterisk is decorative; the word behind it is what is announced.
    expect(labels.find((label) => (label.textContent ?? "").startsWith("Body"))?.textContent).toContain("(required)");
    expect(keyInput.required).toBe(true);
    expect(bodyInput.required).toBe(true);

    await typeInto(keyInput, templateKey);
    await typeInto(bodyInput, "Write-only template body");
    await act(async () => {
      button(container!, "Create Template").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const created = requests.find(({ method }) => method === "POST");
    expect(created?.url.pathname).toBe(`/api/v1/email/templates/${templateKey}/versions`);
    // Parsed through the shared request schema, so a body that drifts from the
    // contract fails here rather than at the endpoint.
    expect(emailTemplateVersionSchema.parse(JSON.parse(created!.body!))).toEqual({
      content: "Write-only template body",
      contentType: "markdown",
      messageType: "transactional",
    });
    expect(container!.textContent).toContain("Template created");
  });

  it("opens the canonical editor after creating a template from the unmounted list", async () => {
    const templateKey = "new_system_template";
    const version = {
      id: "version-new",
      template_key: templateKey,
      version: 1,
      subject_template: "A new template",
      body: "New template body",
      content_type: "markdown",
      r2_object_key: null,
      checksum_sha256: "b".repeat(64),
      status: "draft",
      created_by_user_id: "user-1",
      created_at: "2026-08-28T12:00:00.000Z",
      message_type: "transactional",
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (url.pathname === "/api/v1/email/templates" && method === "GET") {
          return json({ templates: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname.endsWith(`/${templateKey}/exists`)) return json({ exists: false });
        if (url.pathname.endsWith(`/${templateKey}/versions`) && method === "POST") {
          return json({ success: true, version });
        }
        if (url.pathname.endsWith(`/${templateKey}/versions`) && method === "GET") {
          return json({ versions: [version], page: { limit: 25, offset: 0, total: 1, hasMore: false } });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    mount(<EmailTemplates canWrite />);
    await settle();
    expect(fieldLabels(container!)).toHaveLength(0);
    const newTemplateButton = [...container!.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("New template"),
    );
    await act(() => newTemplateButton!.click());

    await typeInto(labelled<HTMLInputElement>(container!, "Template key"), templateKey);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    // A free key is stated, not left to a green border nobody can rely on.
    const keyInput = labelled<HTMLInputElement>(container!, "Template key");
    expect(keyInput.getAttribute("aria-invalid")).toBeNull();
    expect(byId(container!, keyInput.getAttribute("aria-describedby") ?? "")?.textContent).toContain(
      "Key is available",
    );

    await typeInto(labelled<HTMLInputElement>(container!, "Subject template"), version.subject_template);
    await typeInto(labelled<HTMLTextAreaElement>(container!, "Body"), version.body);

    await act(async () => {
      button(container!, "Create Template").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(container!.textContent).toContain(`Edit: ${templateKey}`);
    expect(container!.querySelector<HTMLTextAreaElement>("#email-template-editor-body")?.value).toBe(version.body);
  });

  it("blocks and announces a key the catalog already holds", async () => {
    const templateKey = "registration_confirm_email";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === "/api/v1/email/templates") {
          return json({ templates: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname.endsWith("/exists")) return json({ exists: true });
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    mount(<EmailTemplates canWrite />);
    await settle();
    await act(() => {
      [...container!.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.includes("New template"))!
        .click();
    });

    await typeInto(labelled<HTMLInputElement>(container!, "Template key"), templateKey);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    await settle();

    const keyInput = labelled<HTMLInputElement>(container!, "Template key");
    expect(keyInput.getAttribute("aria-invalid")).toBe("true");
    const message = byId(container!, keyInput.getAttribute("aria-describedby") ?? "");
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("A template with this key already exists");
    // Color is not the only carrier: the button that would submit is inert.
    expect(button(container!, "Create Template").disabled).toBe(true);
  });

  it("keeps the form and says why when the create is rejected", async () => {
    toastArea = document.createElement("div");
    toastArea.id = "portal-toast-area";
    document.body.append(toastArea);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: { code: "CONFLICT", message: "A template with this key already exists." } }, 409),
      ),
    );

    mount(<EmailTemplates canRead={false} canWrite />);
    await settle();

    await typeInto(labelled<HTMLInputElement>(container!, "Template key"), "conflicting_template");
    await typeInto(labelled<HTMLTextAreaElement>(container!, "Body"), "Body copy");
    await act(async () => {
      button(container!, "Create Template").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(toastArea.textContent).toContain("A template with this key already exists.");
    // The rejection is recoverable: the form is still there and still usable.
    expect(labelled<HTMLInputElement>(container!, "Template key").value).toBe("conflicting_template");
    expect(button(container!, "Create Template").disabled).toBe(false);
    expect(container!.textContent).not.toContain("Template created");
  });

  it("uses the canonical system API and keeps read-only users away from preview and writes", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        if (url.pathname === "/api/v1/email/templates") {
          return json({
            templates: [
              { template_key: "registration_confirm_email", active_version: 1, version_count: 1, draft_count: 2 },
            ],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          });
        }
        if (url.pathname.endsWith("/versions")) {
          return json({
            versions: [
              {
                id: "version-1",
                template_key: "registration_confirm_email",
                version: 1,
                subject_template: "Welcome {{firstName}}",
                body: "Hello {{firstName}}",
                content_type: "markdown",
                r2_object_key: null,
                checksum_sha256: "a".repeat(64),
                status: "active",
                created_by_user_id: "user-1",
                created_at: "2026-08-27T12:00:00.000Z",
                message_type: "transactional",
              },
            ],
            page: { limit: 1, offset: 0, total: 1, hasMore: false },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    mount(<EmailTemplates canWrite={false} />);
    await settle();

    // The list is a named table rather than one of four anonymous ones.
    expect(container!.querySelector("caption")?.textContent).toContain("Email templates");
    expect(container!.textContent).toContain("registration_confirm_email");
    // A pending draft says so in words; the tone alone would not.
    expect(container!.textContent).toContain("draft pending");

    const viewButton = [...container!.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("View"),
    );
    expect(viewButton).toBeDefined();
    await act(async () => {
      viewButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(requests.every((url) => url.pathname.startsWith("/api/v1/email/templates"))).toBe(true);
    expect(container!.querySelector("#email-template-editor-body")).not.toBeNull();
    expect(container!.querySelector("#email-template-editor-body")?.getAttribute("readonly")).not.toBeNull();
    expect(container!.querySelector("#email-template-preview-data")).toBeNull();
    expect(container!.textContent).not.toContain("Render Preview");
    expect(container!.textContent).not.toContain("Save as Draft");
    expect(container!.textContent).not.toContain("Activate");
  });
});
