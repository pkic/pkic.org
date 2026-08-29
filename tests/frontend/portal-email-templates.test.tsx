// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailTemplates } from "../../assets/ts/member-flows/portal/sections/email-templates/EmailTemplates";

let container: HTMLDivElement | null = null;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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
  vi.unstubAllGlobals();
});

describe("portal email templates", () => {
  it("lets a writer create a template without loading catalog or version history", async () => {
    const templateKey = "write_only_template";
    const requests: Array<{ url: URL; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({ url, method: init?.method ?? "GET" });
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

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<EmailTemplates canRead={false} canWrite />, container!));
    await settle();
    expect(requests).toEqual([]);

    const keyInput = container.querySelector<HTMLInputElement>("#email-template-key")!;
    const bodyInput = container.querySelector<HTMLTextAreaElement>("#email-template-body")!;
    keyInput.value = templateKey;
    bodyInput.value = "Write-only template body";
    await act(() => {
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
      bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(container!.querySelectorAll("button"))
        .find((button) => button.textContent === "Create Template")!
        .click();
    });
    await settle();

    expect(requests).toEqual([
      expect.objectContaining({
        url: expect.objectContaining({ pathname: `/api/v1/email/templates/${templateKey}/versions` }),
        method: "POST",
      }),
    ]);
    expect(container.textContent).toContain("Template created");
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

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<EmailTemplates canWrite />, container!));
    await settle();
    const newTemplateButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("New Template"),
    );
    await act(() => newTemplateButton!.click());

    const keyInput = container.querySelector<HTMLInputElement>("#email-template-key")!;
    keyInput.value = templateKey;
    await act(() => {
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    const subjectInput = container.querySelector<HTMLInputElement>("#email-template-subject")!;
    subjectInput.value = version.subject_template;
    await act(() => {
      subjectInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const bodyInput = container.querySelector<HTMLTextAreaElement>("#email-template-body")!;
    bodyInput.value = version.body;
    await act(() => {
      bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Create Template",
    );
    await act(async () => {
      createButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(container.textContent).toContain(`Edit: ${templateKey}`);
    expect(container.querySelector<HTMLTextAreaElement>("#email-template-editor-body")?.value).toBe(version.body);
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
              { template_key: "registration_confirm_email", active_version: 1, version_count: 1, draft_count: 0 },
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

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<EmailTemplates canWrite={false} />, container!));
    await settle();

    expect(container.textContent).toContain("registration_confirm_email");
    const viewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("View"),
    );
    expect(viewButton).toBeDefined();
    await act(async () => {
      viewButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(requests.every((url) => url.pathname.startsWith("/api/v1/email/templates"))).toBe(true);
    expect(container.querySelector("#email-template-editor-body")).not.toBeNull();
    expect(container.querySelector("#email-template-editor-body")?.getAttribute("readonly")).not.toBeNull();
    expect(container.querySelector("#email-template-preview-data")).toBeNull();
    expect(container.textContent).not.toContain("Render Preview");
    expect(container.textContent).not.toContain("Save as Draft");
    expect(container.textContent).not.toContain("Activate");
  });
});
