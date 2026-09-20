import { markdownControl, markdownValue, typeMarkdown } from "./helpers/labelled-control";
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateEditor } from "../../assets/ts/member-flows/portal/sections/email-templates/EmailTemplateEditor";
import {
  emailTemplatePreviewSchema,
  emailTemplateVersionSchema,
  type EmailTemplateVersion,
} from "../../assets/shared/schemas/email-templates";
import { emailContentTypeSchema, emailMessageTypeSchema } from "../../assets/shared/schemas/api-common";
import { controlFor, labelNames, optionValues } from "./helpers/labelled-control";
import { menuItemNamed, openRowMenu } from "./helpers/row-actions";

const TEMPLATE_KEY = "welcome_email";
const VERSIONS_PATH = `/api/v1/email/templates/${TEMPLATE_KEY}/versions`;
const PREVIEW_PATH = "/api/v1/email/templates/preview";

const ACTIVE_VERSION: EmailTemplateVersion = {
  id: "version-1",
  template_key: TEMPLATE_KEY,
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
  from_email: null,
  from_name: null,
};

const RENDERED_HTML = "<p>Hello Jane</p>";
const RENDERED_TEXT = "Hello Jane";

let container: HTMLDivElement | null = null;
let toastArea: HTMLDivElement | null = null;

interface CapturedRequest {
  pathname: string;
  method: string;
  body: unknown;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiError(message: string, status = 500): Response {
  return json({ error: { code: "RENDER_FAILED", message } }, status);
}

/**
 * One fetch double for the whole surface. `previewResponse` is a factory so a
 * test can make the render fail without rebuilding the rest of the endpoints.
 */
function stubApi(previewResponse: () => Response = () => json(previewPayload())): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href, location.origin);
      const method = init?.method ?? "GET";
      requests.push({
        pathname: url.pathname,
        method,
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
      });
      if (url.pathname === VERSIONS_PATH && method === "GET") {
        return json({ versions: [ACTIVE_VERSION], page: { limit: 25, offset: 0, total: 1, hasMore: false } });
      }
      if (url.pathname === PREVIEW_PATH && method === "POST") return previewResponse();
      if (url.pathname === VERSIONS_PATH && method === "POST") {
        return json({ success: true, version: { ...ACTIVE_VERSION, id: "version-2", version: 2, status: "draft" } });
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}

function previewPayload() {
  return {
    success: true,
    subject: "Welcome Jane",
    html: RENDERED_HTML,
    text: RENDERED_TEXT,
    data: { firstName: "Jane" },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(props: { canWrite?: boolean; onBack?: () => void } = {}): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  await act(() =>
    render(
      <TemplateEditor
        templateKey={TEMPLATE_KEY}
        initialVersion={ACTIVE_VERSION}
        canWrite={props.canWrite ?? true}
        onBack={props.onBack ?? (() => undefined)}
      />,
      container!,
    ),
  );
  await settle();
  await markdownControl(container!, "Body");
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll("button")).find((element) => element.textContent?.trim() === label);
}

async function click(label: string): Promise<void> {
  const target = button(label);
  if (!target) throw new Error(`No button labelled "${label}"`);
  await act(() => target.click());
  await settle();
}

/** Types into the control the given label names, resolved through the for/id pair. */
async function typeInto(label: string, value: string): Promise<void> {
  if (label === "Body") {
    await typeMarkdown(container!, label, value);
    await settle();
    return;
  }
  const field = controlFor<HTMLTextAreaElement | HTMLInputElement>(container!, label);
  field.value = value;
  await act(() => {
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

function toastMessages(): string[] {
  return Array.from(toastArea!.children).map((element) => element.textContent ?? "");
}

function previewFrame(): HTMLIFrameElement | null {
  return container!.querySelector<HTMLIFrameElement>("iframe[title='Rendered email HTML preview']");
}

beforeEach(() => {
  toastArea = document.createElement("div");
  toastArea.id = "portal-toast-area";
  document.body.append(toastArea);
});

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

describe("portal email template editor", () => {
  it("sends an inserted reusable template to preview without Markdown escaping its syntax", async () => {
    const requests = stubApi();
    await mount();
    await act(async () =>
      container!.querySelector<HTMLButtonElement>('button[aria-label="Insert reusable templates"]')!.click(),
    );
    const partial = [...container!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.startsWith("about_pkic"),
    );
    expect(partial).toBeDefined();
    await act(async () => partial!.click());
    await click("Render Preview");
    const request = requests.find((entry) => entry.pathname === PREVIEW_PATH)!;
    expect(emailTemplatePreviewSchema.parse(request.body).content).toContain("{{> about_pkic}}");
  });

  it("renders on the design system rather than the legacy stylesheet", async () => {
    stubApi();
    await mount();

    const root = container!.firstElementChild!;
    expect(root.classList.contains("pk")).toBe(true);
    const source = await markdownControl(container!, "Body");
    expect(source.getAttribute("contenteditable")).toBe("true");
    expect(source.textContent).toContain("firstName");
    // The preview is untrusted rendered HTML and stays fully sandboxed.
    expect(previewFrame()!.getAttribute("sandbox")).toBe("");
  });

  it("offers the content and message types the version contract accepts", async () => {
    stubApi();
    await mount();

    // The editor writes a version through the same vocabularies the API parses,
    // so the choices are read from those schemas rather than restated here.
    expect(optionValues(controlFor<HTMLSelectElement>(container!, "Content type"))).toEqual(
      emailContentTypeSchema.options,
    );
    expect(optionValues(controlFor<HTMLSelectElement>(container!, "Default message type"))).toEqual(
      emailMessageTypeSchema.options,
    );
  });

  it("previews the edited body and only then allows saving a draft", async () => {
    const requests = stubApi();
    await mount();

    const save = () => button("Save as Draft")!;
    expect(save().disabled).toBe(true);

    const revised = "Hello {{firstName}}, this revision is ready.";
    await typeInto("Body", revised);
    await click("Render Preview");

    const preview = requests.find((request) => request.pathname === PREVIEW_PATH)!;
    const previewBody = emailTemplatePreviewSchema.parse(preview.body);
    expect(previewBody.content).toBe(revised);
    expect(previewBody.contentType).toBe("markdown");
    expect(previewBody.subjectTemplate).toBe(ACTIVE_VERSION.subject_template);
    expect(previewBody.data).toMatchObject({ firstName: "Jane" });

    expect(container!.textContent).toContain("Preview rendered.");
    expect(previewFrame()!.srcdoc).toBe(RENDERED_HTML);
    expect(save().disabled).toBe(false);

    // The sender the template names goes with the version (#106).
    await typeInto("From address", "membership@pkic.org");
    await typeInto("From name", "PKIC Membership");
    await click("Save as Draft");
    const created = requests.filter((request) => request.pathname === VERSIONS_PATH && request.method === "POST");
    expect(created).toHaveLength(1);
    expect(emailTemplateVersionSchema.parse(created[0].body)).toMatchObject({
      content: revised,
      fromEmail: "membership@pkic.org",
      fromName: "PKIC Membership",
    });
    expect(toastMessages()).toContain("Saved as draft v2");
  });

  it("re-fills the preview frame when the viewer switches back from the text tab", async () => {
    stubApi();
    await mount();
    await typeInto("Body", "Hello {{firstName}}!");
    await click("Render Preview");

    await click("Text");
    expect(previewFrame()).toBeNull();
    expect(container!.querySelector(".pk-code-block")?.textContent).toBe(RENDERED_TEXT);

    await click("HTML");
    // The frame is a brand-new element, so the rendered HTML has to be written
    // into it again; before this was fixed the viewer came back to a blank box.
    expect(previewFrame()!.srcdoc).toBe(RENDERED_HTML);
  });

  it("rejects preview data that is not a JSON object without calling the API", async () => {
    const requests = stubApi();
    await mount();

    await typeInto("Preview data (JSON)", "[1, 2, 3]");
    await click("Render Preview");
    expect(requests.some((request) => request.pathname === PREVIEW_PATH)).toBe(false);
    expect(toastMessages().join(" ")).toContain("Invalid preview JSON: Must be a JSON object");

    await typeInto("Preview data (JSON)", "{ not json");
    await click("Render Preview");
    expect(requests.some((request) => request.pathname === PREVIEW_PATH)).toBe(false);
    expect(button("Save as Draft")!.disabled).toBe(true);
  });

  it("refuses to preview an empty body", async () => {
    const requests = stubApi();
    await mount();

    await typeInto("Body", "   ");
    await click("Render Preview");

    expect(requests.some((request) => request.pathname === PREVIEW_PATH)).toBe(false);
    expect(toastMessages()).toContain("Body cannot be empty");
  });

  it("reports a failed render in the status region and keeps saving blocked", async () => {
    const requests = stubApi(() => apiError("Template expansion failed"));
    await mount();

    await typeInto("Body", "Hello {{#each broken}}");
    await click("Render Preview");

    expect(requests.filter((request) => request.pathname === PREVIEW_PATH)).toHaveLength(1);
    const status = container!.querySelector("[role='status']")!;
    expect(status.textContent).toBe("Template expansion failed");
    expect(toastMessages()).toContain("Template expansion failed");
    expect(button("Save as Draft")!.disabled).toBe(true);
    expect(requests.some((request) => request.pathname === VERSIONS_PATH && request.method === "POST")).toBe(false);
  });

  it("reports a failed save and leaves the editor open", async () => {
    const requests = stubApi();
    await mount();
    await typeInto("Body", "Hello {{firstName}}, again.");
    await click("Render Preview");

    vi.mocked(fetch).mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({ pathname: new URL(href, location.origin).pathname, method: init?.method ?? "GET", body: null });
      return apiError("Version conflict", 409);
    });
    await click("Save as Draft");

    expect(toastMessages()).toContain("Version conflict");
    // Still previewed, still editable — a failed save must not clear the draft.
    expect(await markdownValue(container!, "Body")).toBe("Hello {{firstName}}, again.");
    expect(button("Save as Draft")!.disabled).toBe(false);
  });

  it("gives a reader the template without any write affordance", async () => {
    stubApi();
    await mount({ canWrite: false });

    expect(controlFor<HTMLElement>(container!, "Body").getAttribute("aria-disabled")).toBe("true");
    expect(labelNames(container!)).not.toContain("Preview data (JSON)");
    expect(previewFrame()).toBeNull();
    expect(button("Render Preview")).toBeUndefined();
    expect(button("Save as Draft")).toBeUndefined();
    expect(button("Activate")).toBeUndefined();
    expect(container!.textContent).toContain("Read-only access.");
    // The version in use says so once, in its Status column; the row's menu
    // offers a reader the load command and nothing that writes (#98).
    expect(container!.textContent).not.toContain("In use");
    await openRowMenu(container!, "v1");
    expect(menuItemNamed(container!, "Load into editor")).not.toBeNull();
    expect(menuItemNamed(container!, "Activate")).toBeNull();
  });

  it("activates a draft from its row's menu rather than a button in the row", async () => {
    const requests = stubApi();
    await mount();
    // Nothing in the history is a button of its own: the version in use has
    // no "Activate", and a row's commands sit behind its menu.
    expect(button("Activate")).toBeUndefined();
    await openRowMenu(container!, "v1");
    expect(menuItemNamed(container!, "Activate")).toBeNull();
    expect(menuItemNamed(container!, "Load into editor")).not.toBeNull();
    expect(requests.every((request) => request.pathname !== `/api/v1/email/templates/${TEMPLATE_KEY}/activate`)).toBe(
      true,
    );
  });

  it("returns to the list from the panel header", async () => {
    stubApi();
    const onBack = vi.fn();
    await mount({ onBack });

    expect(container!.querySelector("h3")?.textContent).toBe(`Edit: ${TEMPLATE_KEY}`);
    await click("← Back to list");
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
