// @vitest-environment jsdom
/**
 * The registration detail surface after its move onto the design system.
 *
 * The Bootstrap version signalled a queued email and a rejected one with
 * `text-success` / `text-danger` on the same span, copied the referral link
 * without ever saying whether it had worked, and labelled that field with a
 * `form-label` that pointed at nothing. These assert the replacements: an
 * announced outcome, a live region for the copy, and a label bound to a real
 * control.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegistrationDetailPage } from "../../assets/ts/member-flows/portal/sections/events/detail/RegistrationDetailPage";
import { eventRegistrationDetailResponseSchema } from "../../assets/shared/schemas/event-registration-detail";
import { eventRegistrationNotificationCreateSchema } from "../../assets/shared/schemas/route-contracts-event-registration-management";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => [`/events/summit/registrations/detail/${REG_ID}`, navigate],
}));

const SLUG = "summit";
const REG_ID = "11111111-1111-4111-8111-111111111111";
const REGISTRATION_PATH = `/api/v1/events/${SLUG}/registrations/${REG_ID}`;

const detailResponse = eventRegistrationDetailResponseSchema.parse({
  registration: {
    id: REG_ID,
    event_id: SLUG,
    user_id: "22222222-2222-4222-8222-222222222222",
    status: "registered",
    cancellation_reason_code: null,
    attendance_type: "in_person",
    source_type: "referral",
    rsvp_status: null,
    rsvpByDay: [],
    customAnswers: null,
    created_at: "2026-08-01T09:00:00.000Z",
    updated_at: "2026-08-01T09:00:00.000Z",
    user_email: "attendee@example.test",
    display_name: "Attendee One",
    referral_code: "abc123",
  },
  form: null,
  dayAttendance: [],
  dayWaitlist: [],
});

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input, location.origin);
  if (input instanceof URL) return input;
  return new URL(input.url, location.origin);
}

interface Captured {
  method: string;
  pathname: string;
  body?: string;
}

/**
 * Serves everything the page and its two child panels fetch. `notifications`
 * is the one route a test varies, so it is handed in rather than branched on
 * inside the stub.
 */
function stubApi(notifications: () => Response): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = requestUrl(input);
      const method = init.method ?? "GET";
      captured.push({
        method,
        pathname: url.pathname,
        body: typeof init.body === "string" ? init.body : undefined,
      });
      if (url.pathname.endsWith("/notifications")) return notifications();
      if (url.pathname.endsWith("/badge")) {
        return json({
          admin_override: null,
          auto_detected: "attendee",
          effective_role: "attendee",
          available_roles: ["attendee", "speaker"],
        });
      }
      if (url.pathname.endsWith("/audit")) {
        return json({ auditLog: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      }
      if (url.pathname === REGISTRATION_PATH) return json(detailResponse);
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return captured;
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes(name));
  expect(match, `no button named "${name}"`).toBeDefined();
  return match!;
}

/** `useId` emits ids a CSS selector would have to escape, and jsdom has no `CSS.escape`. */
function byId(container: HTMLElement, id: string): HTMLElement | null {
  return [...container.querySelectorAll<HTMLElement>("[id]")].find((element) => element.id === id) ?? null;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  navigate.mockReset();
});

describe("registration detail", () => {
  it("names every control and binds the referral field's label to a real input", async () => {
    stubApi(() => json({ success: true, message: "Email queued" }));

    const container = mount(<RegistrationDetailPage slug={SLUG} regId={REG_ID} />);
    await settle();

    // The surface opts into the design system's base layer; without the root
    // class it keeps inheriting Bootstrap's reboot.
    expect(container.firstElementChild?.classList.contains("pk")).toBe(true);

    const labels = [...container.querySelectorAll<HTMLLabelElement>("label.pk-field__label")];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(byId(container, label.htmlFor), `label "${label.textContent ?? ""}" points at nothing`).not.toBeNull();
    }

    const referral = labels.find((label) => (label.textContent ?? "").startsWith("Referral link"));
    const input = referral ? (byId(container, referral.htmlFor) as HTMLInputElement | null) : null;
    expect(input?.value).toBe(`${location.origin}/r/abc123`);
    expect(input?.readOnly).toBe(true);
    // The help text is bound, not merely printed beside the control.
    const describedBy = input?.getAttribute("aria-describedby") ?? "";
    expect(describedBy).not.toBe("");
    expect(byId(container, describedBy)?.textContent).toContain("credited to this attendee");

    // The badge link opens in a new tab, so it is an anchor with a name — not
    // an icon-only control, and not a click handler on a div.
    const badgeLink = [...container.querySelectorAll("a")].find((anchor) =>
      (anchor.textContent ?? "").includes("View badge"),
    );
    expect(badgeLink?.getAttribute("href")).toBe(`${location.origin}/api/v1/registrations/referrals/abc123/badge`);
    expect(badgeLink?.getAttribute("rel")).toBe("noopener");

    // The history table names itself rather than being announced as "table".
    expect(container.querySelector("caption")?.textContent).toContain("Audit history");
  });

  it("sends the shared notification contract and announces the queued email", async () => {
    const captured = stubApi(() => json({ success: true, message: "Email queued" }));

    const container = mount(<RegistrationDetailPage slug={SLUG} regId={REG_ID} />);
    await settle();

    await act(async () => {
      buttonNamed(container, "Resend email").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const posted = captured.find(({ method, pathname }) => method === "POST" && pathname.endsWith("/notifications"));
    expect(posted).toBeDefined();
    // Parsed through the shared request schema, so a body that drifts from the
    // contract fails here rather than in production.
    expect(eventRegistrationNotificationCreateSchema.parse(JSON.parse(posted!.body!))).toEqual({
      type: "confirmation",
    });

    const announced = container.querySelector('[role="status"].pk-alert');
    expect(announced?.textContent).toContain("Confirmation email queued.");
  });

  it("announces a refused resend instead of tinting the same span red", async () => {
    stubApi(() => json({ error: { code: "RATE_LIMITED", message: "Too many attempts." } }, 429));

    const container = mount(<RegistrationDetailPage slug={SLUG} regId={REG_ID} />);
    await settle();

    await act(async () => {
      buttonNamed(container, "Resend email").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Too many attempts.");
    // The old surface distinguished the two outcomes by hue alone.
    expect(container.querySelector(".text-danger")).toBeNull();
    expect(container.querySelector(".text-success")).toBeNull();
    // The control stays usable so the reader can try again.
    expect(buttonNamed(container, "Resend email").disabled).toBe(false);
  });

  it("says so when the clipboard refuses the referral link", async () => {
    stubApi(() => json({ success: true, message: "Email queued" }));

    const container = mount(<RegistrationDetailPage slug={SLUG} regId={REG_ID} />);
    await settle();

    const liveRegion = container.querySelector('p[role="status"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toBe("");

    // jsdom exposes no clipboard; a rejection is exactly the production case
    // of an insecure origin or a withheld permission.
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });

    await act(async () => {
      buttonNamed(container, "Copy link").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(container.querySelector('p[role="status"]')?.textContent).toContain("copy it manually");
  });

  it("reports a failed load through the shared error alert rather than an empty page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "NOT_FOUND", message: "Registration not found." } }, 404)),
    );

    const container = mount(<RegistrationDetailPage slug={SLUG} regId={REG_ID} />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.className).toContain("pk-alert");
    expect(alert?.textContent).toContain("Registration not found.");
    // Nothing else renders behind the failure, so no half-loaded panel is left
    // claiming the registration is fine.
    expect(container.textContent).not.toContain("Audit log");
  });
});
