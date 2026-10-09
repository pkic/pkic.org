// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendeeParticipationSections } from "../../assets/ts/member-flows/portal/sections/events/detail/registration-detail/AttendeeParticipationSections";
import { portalSession, authStatus } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import {
  registrationSessionsQuerySchema,
  registrationSessionsResponseSchema,
} from "../../assets/shared/schemas/event-registration-sessions";
import {
  badgeCredentialsQuerySchema,
  badgeCredentialsResponseSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import {
  attendanceEvidenceQuerySchema,
  attendanceEvidenceResponseSchema,
} from "../../assets/shared/schemas/event-attendance-corrections";
import {
  attendanceAttemptQuerySchema,
  attendanceAttemptsResponseSchema,
} from "../../assets/shared/schemas/event-attendance-reporting";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/events/summit/registrations/detail", vi.fn()],
}));
const eventId = "10000000-0000-4000-8000-000000000001";
const registrationId = "20000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000001";
const occurrenceId = "40000000-0000-4000-8000-000000000001";
const roots: HTMLElement[] = [];
const page = { limit: 50, offset: 0, total: 0, hasMore: false };

function mount(node: ComponentChildren) {
  const root = document.createElement("div");
  document.body.append(root);
  roots.push(root);
  void act(() => render(node, root));
  return root;
}
function view(id = registrationId, user = userId, canManage = true) {
  return (
    <AttendeeParticipationSections
      slug="summit"
      eventId={eventId}
      registrationId={id}
      userId={user}
      canManage={canManage}
      registration={<p>Registration intent</p>}
      history={<p>Audit evidence</p>}
    />
  );
}
function session(attendance = false) {
  portalSession.value = portalSessionFixture({
    staff: true,
    administrator: false,
    grants: [
      { permission: "events:manage", contextType: "event", contextId: eventId },
      ...(attendance ? [{ permission: "agenda:attendance_read", contextType: "event", contextId: eventId }] : []),
    ],
  });
  authStatus.value = "authenticated";
}
async function tab(root: HTMLElement, name: string) {
  await act(async () => {
    const button = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (item) => item.textContent === name,
    );
    expect(button, `Missing ${name} tab`).toBeDefined();
    button!.click();
  });
}
function api(refused = () => false) {
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      requests.push(url);
      const query = Object.fromEntries(url.searchParams);
      let body: unknown;
      if (url.pathname.endsWith("/sessions")) {
        registrationSessionsQuerySchema.parse(query);
        if (refused())
          return new Response(
            JSON.stringify({ error: { code: "FORBIDDEN", message: "Attendee session access was withdrawn." } }),
            { status: 403, headers: { "content-type": "application/json" } },
          );
        body = registrationSessionsResponseSchema.parse({
          sessions: [
            {
              id: occurrenceId,
              title: "Saved and reserved session",
              publishedRevision: 2,
              timeZone: "Europe/Amsterdam",
              startAt: "2026-10-07T08:00:00.000Z",
              endAt: "2026-10-07T09:00:00.000Z",
              admissionPolicy: "reservation",
              rooms: [{ id: eventId, name: "East room" }],
              roomId: eventId,
              saved: true,
              status: "reserved",
              attendanceMode: "physical",
              createdAt: "2026-10-01T08:00:00.000Z",
              updatedAt: "2026-10-01T08:00:00.000Z",
            },
          ],
          page: { ...page, total: 1 },
        });
      } else if (url.pathname.endsWith("/badges")) {
        badgeCredentialsQuerySchema.parse(query);
        body = badgeCredentialsResponseSchema.parse({ badges: [], page });
      } else if (url.pathname.endsWith("/observations")) {
        attendanceEvidenceQuerySchema.parse(query);
        body = attendanceEvidenceResponseSchema.parse({
          observations: [],
          page,
          retentionPolicy: "retained_with_original_observation",
        });
      } else if (url.pathname.endsWith("/attempts")) {
        attendanceAttemptQuerySchema.parse(query);
        body = attendanceAttemptsResponseSchema.parse({ attempts: [], page });
      } else throw new Error(`Unexpected attendee request ${url.pathname}`);
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }),
  );
  return requests;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    void act(() => render(null, root));
    root.remove();
  }
  portalSession.value = null;
  authStatus.value = "anonymous";
  history.replaceState(null, "", location.pathname);
  vi.unstubAllGlobals();
});

describe("event attendee sections", () => {
  it("loads no secondary resources until selected, then requests fixed badge metadata only", async () => {
    session();
    history.replaceState(
      null,
      "",
      `#/events/summit/registrations/detail/${registrationId}?badges.f.userId=30000000-0000-4000-8000-000000000099`,
    );
    const requests = api();
    const root = mount(view());
    expect(requests).toHaveLength(0);
    expect(root.textContent).not.toContain("App activity");
    expect(root.textContent).not.toContain("Questions");
    expect(root.querySelector("details")).toBeNull();
    await tab(root, "Badge");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].pathname).toBe("/api/v1/events/summit/badges");
    expect(requests[0].searchParams.get("userId")).toBe(userId);
    expect(requests.some((url) => url.pathname.endsWith("/print"))).toBe(false);
  });
  it("keeps favorites independent from reservation and uses the selected registration endpoint", async () => {
    session();
    const requests = api();
    const root = mount(view());
    await tab(root, "Sessions");
    await vi.waitFor(() => expect(root.textContent).toContain("East room"));
    expect(root.textContent).toContain("Saved and reserved session");
    expect(root.querySelector('[role="img"][aria-label="Saved"]')).not.toBeNull();
    expect(root.textContent).toContain("Reserved");
    expect(requests[0].pathname).toBe(`/api/v1/events/summit/registrations/${registrationId}/sessions`);
    expect(requests[0].searchParams.has("userId")).toBe(false);
    expect(root.textContent).toContain("reservations do not confirm attendance");
  });
  it("requires independent attendance permission and mounts original evidence and scan log separately", async () => {
    session(true);
    const requests = api();
    const root = mount(view());
    await tab(root, "Check-ins");
    await vi.waitFor(() => expect(requests.some((url) => url.pathname.endsWith("/observations"))).toBe(true));
    expect(requests.every((url) => url.searchParams.get("userId") === userId)).toBe(true);
    expect(requests.some((url) => url.pathname.endsWith("/attempts"))).toBe(false);
    await tab(root, "Scan log");
    await vi.waitFor(() => expect(requests.some((url) => url.pathname.endsWith("/attempts"))).toBe(true));
    await act(async () => {
      session(false);
    });
    expect([...root.querySelectorAll('[role="tab"]')].map((node) => node.textContent)).not.toContain("Check-ins");
    expect(root.textContent).not.toContain("Scan log");
  });
  it("keeps attendance-only readers out of badges, private intent and audit", () => {
    session(true);
    const requests = api();
    const root = mount(view(registrationId, userId, false));
    const tabs = [...root.querySelectorAll('[role="tab"]')].map((node) => node.textContent);
    expect(tabs).toEqual(["Registration", "Check-ins"]);
    expect(requests).toHaveLength(0);
    expect(root.textContent).not.toContain("Audit evidence");
  });
  it("clears the old attendee on identity change and does not inherit their tab or page", async () => {
    session();
    const requests = api();
    const root = mount(view());
    await tab(root, "Sessions");
    await vi.waitFor(() => expect(root.textContent).toContain("East room"));
    await act(async () =>
      render(view("20000000-0000-4000-8000-000000000002", "30000000-0000-4000-8000-000000000002"), root),
    );
    expect(root.textContent).not.toContain("East room");
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Registration");
    expect(requests).toHaveLength(1);
  });
  it("removes previously loaded intent after the canonical API refuses access", async () => {
    session();
    let refused = false;
    const requests = api(() => refused);
    const root = mount(view());
    await tab(root, "Sessions");
    await vi.waitFor(() => expect(root.textContent).toContain("East room"));
    refused = true;
    await act(async () => root.querySelector<HTMLButtonElement>('button[title="Refresh attendee sessions"]')!.click());
    await vi.waitFor(() => expect(root.textContent).toContain("Attendee session access was withdrawn."));
    expect(root.textContent).not.toContain("East room");
    expect(root.textContent).not.toContain("Saved and reserved session");
    expect(requests).toHaveLength(2);
  });
});
