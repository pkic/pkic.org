// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import {
  eventEmailCampaignCreateInputSchema,
  eventEmailCampaignPreviewInputSchema,
} from "../../assets/shared/schemas/event-email-campaigns";
import { EventEmailCampaign } from "../../assets/ts/components/events/EventEmailCampaign";
import { controlFor, labelNames } from "./helpers/labelled-control";
import { GroupEventWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupEventWorkspace";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", vi.fn()],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

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

function urlOf(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
}

async function inputText(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The send gate: the one checkbox on the surface, or null before a preview exists. */
function confirmationBox(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[type="checkbox"]');
}

function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`No button labelled "${label}"`);
  return act(async () => {
    button.click();
  });
}

const EVENT_PATH = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}`;
const CAMPAIGN_PATH = `${EVENT_PATH}/email/campaigns`;

const PREVIEW_BODY = {
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

interface CapturedRequest {
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
function stubCampaignFetch(routes: { previews: () => Response; campaigns?: () => Response }): CapturedRequest[] {
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
        return json({ days: [], eventUpdatedAt: "2026-08-29T08:00:00.000Z" });
      }
      if (method === "POST" && url.pathname === `${CAMPAIGN_PATH}/previews`) {
        return routes.previews();
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
async function composeAndPreview(container: HTMLElement): Promise<void> {
  await inputText(controlFor(container, "Subject"), "Working group update");
  await inputText(controlFor<HTMLTextAreaElement>(container, "Message"), "Hello {{firstName}}");
  await clickButton(container, "Preview Email");
  await settle();
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("event email campaign UI", () => {
  it("previews and creates a campaign through one canonical nested resource", async () => {
    const requests = stubCampaignFetch({
      previews: () => json(PREVIEW_BODY),
      campaigns: () => json({ success: true, queuedRecipients: 1, queuedBatches: 1, mode: "personal" }, 202),
    });

    const container = mount(<EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} />);
    await composeAndPreview(container);

    // Parsed through the shared request contract rather than compared field by
    // field: a payload the schema rejects is a broken request whatever a
    // literal comparison of one property says.
    const previewRequest = requests.find(({ path }) => path === `${CAMPAIGN_PATH}/previews`);
    const previewInput = eventEmailCampaignPreviewInputSchema.parse(previewRequest?.body);
    expect(previewInput.filter.audience).toBe("attendees");
    expect(previewInput.subjectOverride).toBe("Working group update");
    expect(previewInput.sendMode).toBe("personal");

    const confirmation = confirmationBox(container)!;
    await act(async () => confirmation.click());
    await clickButton(container, "Send Email");
    await settle();

    const sendRequest = requests.find(({ method, path }) => method === "POST" && path === CAMPAIGN_PATH);
    const sendInput = eventEmailCampaignCreateInputSchema.parse(sendRequest?.body);
    expect(sendInput.previewToken).toBe("campaign-preview-token");
    expect(sendInput.bodyContent).toBe("Hello {{firstName}}");
    expect(requests.every(({ path }) => !path.startsWith("/api/v1/admin/"))).toBe(true);
  });

  it("isolates the untrusted preview HTML and names the surface for assistive technology", async () => {
    stubCampaignFetch({ previews: () => json(PREVIEW_BODY) });

    const container = mount(<EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} />);
    await composeAndPreview(container);

    // The rendered email is author-supplied HTML. It must stay in a fully
    // sandboxed srcdoc frame — no scripts, no forms, no same-origin access,
    // and no network fetch of its own.
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toBe("<p>Hello</p>");
    expect(frame.hasAttribute("src")).toBe(false);
    expect(frame.getAttribute("title")).toBe("Rendered campaign email preview");

    // The send outcome is announced rather than only shown.
    const live = container.querySelector('[role="status"]')!;
    expect(live.textContent).toContain("Preview ready");

    // The confirmation gate is the design system's checkbox: the label wraps
    // the control, so the whole line is the hit target.
    const confirmation = confirmationBox(container)!;
    expect(confirmation.classList.contains("pk-check__input")).toBe(true);
    const label = confirmation.closest("label")!;
    expect(label.classList.contains("pk-check")).toBe(true);
    expect(label.querySelector(".pk-check__label")?.textContent).toContain("confirm sending");

    // Every control the surface owns is named through its own label, and each
    // label resolves to its control — the lookup fails exactly when the
    // for/id pair is broken.
    const names = [
      "Template",
      "Delivery mode",
      "Message type",
      "Subject",
      "Message",
      "Registration status",
      "Attendance type",
      "Specific day",
      "Day waitlist",
    ];
    expect(labelNames(container)).toEqual(expect.arrayContaining(names));
    for (const name of names) controlFor(container, name);
    expect(controlFor<HTMLTextAreaElement>(container, "Message").tagName).toBe("TEXTAREA");
    expect(controlFor(container, "Template").getAttribute("role")).toBe("combobox");
  });

  it("reports a failed preview and keeps the send gate closed", async () => {
    const notify = vi.fn();
    stubCampaignFetch({
      previews: () => json({ error: { code: "RECIPIENT_QUERY_FAILED", message: "Recipient query failed." } }, 500),
    });

    const container = mount(
      <EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} notify={notify} />,
    );
    await composeAndPreview(container);

    expect(container.querySelector('[role="status"]')!.textContent).toBe("Recipient query failed.");
    expect(notify).toHaveBeenCalledWith("Recipient query failed.", "error");
    // No preview means no confirmation checkbox, and the send button stays
    // disabled: a failed preview can never become a send.
    expect(confirmationBox(container)).toBeNull();
    const send = [...container.querySelectorAll("button")].find((button) => button.textContent === "Send Email")!;
    expect(send.disabled).toBe(true);
  });

  it("reports a rejected send and leaves the composed message intact", async () => {
    const notify = vi.fn();
    stubCampaignFetch({
      previews: () => json(PREVIEW_BODY),
      campaigns: () => json({ error: { code: "PREVIEW_TOKEN_EXPIRED", message: "Preview token expired." } }, 422),
    });

    const container = mount(
      <EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} notify={notify} />,
    );
    await composeAndPreview(container);
    await act(async () => confirmationBox(container)!.click());
    await clickButton(container, "Send Email");
    await settle();

    expect(notify).toHaveBeenCalledWith("Preview token expired.", "error");
    expect(container.querySelector('[role="status"]')!.textContent).toBe("Preview token expired.");
    // The draft is not cleared on failure, so the operator can retry.
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Hello {{firstName}}");
    const send = [...container.querySelectorAll("button")].find((button) => button.textContent === "Send Email")!;
    expect(send.getAttribute("aria-busy")).toBeNull();
    expect(send.disabled).toBe(false);
  });

  it("does not render campaign management without the server-provided manage capability", () => {
    const event: GroupEvent = {
      id: EVENT_ID,
      ownerGroupId: GROUP_ID,
      seriesId: null,
      slug: "read-only-event",
      basePath: null,
      name: "Read-only event",
      timezone: "UTC",
      startsAt: "2026-12-01T08:00:00.000Z",
      endsAt: "2026-12-01T18:00:00.000Z",
      profileKey: "workshop",
      sourceMode: "portal",
      registrationPolicy: "no_registration",
      visibility: "group_members",
      inviteLimitAttendee: 5,
      location: null,
      links: [],
      nextOccurrenceAt: null,
      updatedAt: "2026-08-29T08:00:00.000Z",
      proposalAccess: null,
      capabilities: ["view"],
    };
    const container = mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="communications" />);
    expect(container.textContent).not.toContain("Email campaigns");
  });
});
