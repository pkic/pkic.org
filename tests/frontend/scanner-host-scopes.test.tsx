// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupEventWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupEventWorkspace";
import { SponsorLeads } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SponsorLeads";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: ComponentChildren; href: string }) => <a href={href}>{children}</a>,
}));
const mounts = vi.hoisted(() => ({ count: 0, props: [] as Array<Record<string, unknown>> }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner", () => ({
  EventScanner: (props: Record<string, unknown>) => {
    useEffect(() => {
      mounts.count++;
    }, []);
    mounts.props.push(props);
    return <div>Scoped scanner</div>;
  },
}));
const event: GroupEvent = {
  id: "event-id",
  slug: "event",
  ownerGroupId: "group",
  seriesId: null,
  basePath: "/events/event/",
  name: "Event",
  timezone: "UTC",
  startsAt: null,
  endsAt: null,
  profileKey: "workshop",
  sourceMode: "portal",
  registrationPolicy: "optional",
  visibility: "public",
  inviteLimitAttendee: 5,
  location: null,
  links: [],
  nextOccurrenceAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  proposalAccess: null,
  capabilities: ["view"],
};
let host: HTMLElement;
const previous = portalSession.value;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  portalSession.value = previous;
  mounts.count = 0;
  mounts.props = [];
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function session(permissions: string[], operator = "operator") {
  const value = portalSessionFixture({
    staff: true,
    grants: permissions.map((permission) => ({ permission, contextType: "event", contextId: event.id })),
  });
  value.identity.id = operator;
  return value;
}
async function mountGroup() {
  document.adoptedStyleSheets = [];
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<GroupEventWorkspace event={event} groupId="group" tab="scanner" />, host));
  await settle();
}
describe("scanner hosts", () => {
  it("limits group scanner actions and requires admission authority for exceptions", async () => {
    portalSession.value = session(["agenda:check", "agenda:admit_exceptions"]);
    await mountGroup();
    expect(mounts.props.at(-1)).toMatchObject({
      allowedActions: ["check"],
      canAdmitExceptions: false,
    });
    await act(() => {
      portalSession.value = session(["agenda:admit", "agenda:admit_exceptions", "events:manage"]);
    });
    await settle();
    expect(mounts.props.at(-1)).toMatchObject({
      allowedActions: ["admission", "exception"],
      canAdmitExceptions: true,
    });
  });
  it("remounts group scanner when operator or event changes", async () => {
    portalSession.value = session(["agenda:scan"]);
    await mountGroup();
    const initial = mounts.count;
    await act(() => {
      portalSession.value = session(["agenda:scan"], "second");
    });
    await settle();
    expect(mounts.count).toBe(initial + 1);
    await act(() =>
      render(<GroupEventWorkspace event={{ ...event, slug: "second-event" }} groupId="group" tab="scanner" />, host),
    );
    await settle();
    expect(mounts.count).toBe(initial + 2);
  });
  it("clears sponsor selection when operator or event changes and keeps lead-only scope", async () => {
    portalSession.value = session([]);
    const id = "10000000-0000-4000-8000-000000000001";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sponsors: [{ id, name: "Sponsor", canCapture: true, canView: false, canExport: false }],
              page: { limit: 50, offset: 0, total: 1, hasMore: false },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    );
    document.adoptedStyleSheets = [];
    host = document.createElement("div");
    document.body.append(host);
    await act(() => render(<SponsorLeads slug="event" timeZone="UTC" />, host));
    await settle();
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Open leads for Sponsor"]')!.click());
    await settle();
    await act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Scan leads")!
        .click(),
    );
    await settle();
    expect(mounts.props.at(-1)).toMatchObject({ allowedActions: ["lead"] });
    const initial = mounts.count;
    await act(() => {
      portalSession.value = session([], "second");
    });
    await settle();
    expect(host.textContent).not.toContain("Scoped scanner");
    expect(mounts.count).toBe(initial);
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Open leads for Sponsor"]')!.click());
    await settle();
    await act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Scan leads")!
        .click(),
    );
    await settle();
    expect(mounts.count).toBe(initial + 1);
    expect(mounts.props.at(-1)?.operatorUserId).toBe("second");
    await act(() => render(<SponsorLeads slug="second-event" timeZone="UTC" />, host));
    await settle();
    expect(host.textContent).not.toContain("Scoped scanner");
    expect(mounts.count).toBe(initial + 1);
  });
});
