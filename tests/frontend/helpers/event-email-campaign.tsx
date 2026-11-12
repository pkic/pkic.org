import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";
import { controlFor, typeMarkdown } from "./labeled-control";

/** Shared fixtures for the event message composer tests. */
export const GROUP_ID = "10000000-0000-4000-8000-000000000001";
export const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

export function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function urlOf(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
}

export async function inputText(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`No button labeled "${label}"`);
  return act(async () => {
    button.click();
  });
}

export const EVENT_PATH = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}`;
export const CAMPAIGN_PATH = `${EVENT_PATH}/email/campaigns`;

export const PREVIEW_BODY = {
  success: true,
  recipientCount: 1,
  batchCount: 1,
  previewToken: "campaign-preview-token",
  previewExpiresAt: "2026-08-29T08:10:00.000Z",
  sampleRecipients: ["attendee@example.test"],
  subject: "Working group update",
  html: "<p>Hello</p>",
  text: "Hello",
};

export interface CapturedRequest {
  method: string;
  path: string;
  body: unknown;
}

/**
 * One fetch stub for the whole surface: the template catalog and day list it
 * loads on mount, plus the two campaign endpoints whose outcome each test
 * chooses. `previews` and `campaigns` return a Response so a test can hand
 * back a 4xx/5xx as easily as a success.
 */
export function stubCampaignFetch(routes: {
  previews: () => Response;
  campaigns?: () => Response;
  tests?: () => Response;
  days?: unknown[];
}): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = urlOf(input);
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
      requests.push({ method, path: url.pathname, body });
      if (method === "GET" && url.pathname === "/api/v1/email/templates") {
        return json({ templates: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      }
      if (method === "GET" && url.pathname.endsWith("/days")) {
        return json({ days: routes.days ?? [], eventUpdatedAt: "2026-08-29T08:00:00.000Z" });
      }
      if (method === "POST" && url.pathname === `${CAMPAIGN_PATH}/previews`) {
        return routes.previews();
      }
      if (method === "POST" && url.pathname === `${CAMPAIGN_PATH}/tests` && routes.tests) {
        return routes.tests();
      }
      if (method === "POST" && url.pathname === CAMPAIGN_PATH && routes.campaigns) {
        return routes.campaigns();
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}

/** Fills subject and body, then renders a preview. */
export async function composeAndPreview(container: HTMLElement): Promise<void> {
  await inputText(controlFor(container, "Subject"), "Working group update");
  await typeMarkdown(container, "Message", "Hello {{firstName}}");
  await clickButton(container, "Preview Email");
  await settle();
}

/** Unmounts every composer a test mounted and restores the global fetch. */
export function unmountComposers(): void {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
}
