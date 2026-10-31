// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailTemplates } from "../../assets/ts/member-flows/portal/sections/email-templates/EmailTemplates";
import { markdownControl, markdownValue, typeMarkdown } from "./helpers/labeled-control";

let container: HTMLDivElement | null = null;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mount(node: Parameters<typeof render>[0]): void {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  if (container?.querySelector(".pk-markdown-editor, label.pk-field__label")) await markdownControl(container, "Body");
}

function button(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  expect(found, `no button labeled "${label}"`).toBeDefined();
  return found!;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("routed email template editor", () => {
  it("loads the next template into the editor when the route key changes", async () => {
    const versionFor = (templateKey: string, body: string) => ({
      id: `version-${templateKey}`,
      template_key: templateKey,
      version: 1,
      subject_template: `Subject ${templateKey}`,
      body,
      content_type: "markdown",
      r2_object_key: null,
      checksum_sha256: "a".repeat(64),
      status: "active",
      created_by_user_id: "user-1",
      created_at: "2026-08-27T12:00:00.000Z",
      message_type: "transactional",
      from_email: null,
      from_name: null,
    });
    const bodies: Record<string, string> = { first_template: "First body", second_template: "Second body" };
    const saved: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const templateKey = url.pathname.split("/")[5] ?? "";
        if (url.pathname === "/api/v1/email/templates/preview") {
          return json({ success: true, subject: "S", html: "<p>S</p>", text: "S", data: {} });
        }
        if (url.pathname.endsWith("/versions") && init?.method === "POST") {
          saved.push(url.pathname);
          return json({ success: true, version: versionFor(templateKey, "saved") });
        }
        if (url.pathname.endsWith("/versions")) {
          return json({
            versions: [versionFor(templateKey, bodies[templateKey] ?? "")],
            page: { limit: 1, offset: 0, total: 1, hasMore: false },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    mount(<EmailTemplates canWrite templateKey="first_template" />);
    await settle();
    expect(await markdownValue(container!, "Body")).toBe("First body");

    void act(() => render(<EmailTemplates canWrite templateKey="second_template" />, container!));
    await settle();
    expect(container!.textContent).toContain("second_template");
    expect(await markdownValue(container!, "Body")).toBe("Second body");

    await typeMarkdown(container!, "Body", "Second body edited");
    await act(async () => {
      button("Render Preview").click();
    });
    await settle();
    await act(async () => {
      button("Save as Draft").click();
    });
    await settle();
    expect(saved).toEqual(["/api/v1/email/templates/second_template/versions"]);
  });
});
