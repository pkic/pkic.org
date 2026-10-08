// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantEvent } from "../../assets/ts/member-flows/portal/sections/events/ParticipantEvent";
import { EventWorkspace } from "../../assets/ts/member-flows/portal/sections/events/EventWorkspace";
import { SessionParticipation } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/SessionParticipation";
import { useScannerLocation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerLocation";
import { ScannerLocationSelect } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerLocationSelect";
import { eventAudienceDetailSchema } from "../../assets/shared/schemas/event-management";
import { personalAgendaResponseSchema } from "../../assets/shared/schemas/event-personal-agenda";
import { scannerTargetsResponseSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { eventDestination } from "../../assets/ts/member-flows/portal/sections/events/event-destination";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), scanner: vi.fn(), location: "/events/summit" }));
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => [mocks.location, mocks.navigate] }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner", () => ({
  EventScanner: (props: { occurrenceId?: string | null }) => {
    mocks.scanner(props);
    return <p>Mounted badge scanner</p>;
  },
}));
vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  readActiveUserSession: async () => ({
    sessionId: portalSession.value?.sessionId,
    operatorUserId: portalSession.value?.identity.id,
  }),
  scannerUploadSuspended: async () => false,
}));

const eventId = "a0000000-0000-4000-8000-000000000001";
const sessionId = "a0000000-0000-4000-8000-000000000002";
const sponsorId = "a0000000-0000-4000-8000-000000000003";
const otherSponsorId = "a0000000-0000-4000-8000-000000000004";
const roomIds = ["a0000000-0000-4000-8000-000000000005", "a0000000-0000-4000-8000-000000000006"];
const discovery = {
  canScan: true,
  sponsors: [
    { id: sponsorId, name: "First sponsor" },
    { id: otherSponsorId, name: "Second sponsor" },
  ],
};
let host: HTMLDivElement;
let requests: string[];

function event() {
  return eventAudienceDetailSchema.parse({
    id: eventId,
    slug: "summit",
    name: "Summit",
    timezone: "UTC",
    startsAt: null,
    endsAt: null,
    profileKey: null,
    registrationPolicy: "public",
    visibility: "public",
    accessLevel: "participant",
    location: null,
    links: [],
    basePath: null,
    sponsorLeadAccess: false,
    viewer: null,
    scannerAccess: discovery,
    participation: { registrationId: null, registrationStatus: null, proposals: 0, speakerProposals: 0 },
  });
}
function authority(grants: Array<{ permission: string; contextType: string; contextId: string }>) {
  const session = portalSessionFixture({ member: true, staff: true, grants });
  if (session.staff) {
    session.staff.expiresAt = session.expiresAt;
    session.staff.idleExpiresAt = session.idleExpiresAt;
  }
  portalSession.value = session;
}
const badgeGrant = { permission: "agenda:attendance_record", contextType: "event", contextId: eventId };
const leadGrant = { permission: "agenda:leads_capture", contextType: "event_sponsor", contextId: sponsorId };
const otherLeadGrant = { ...leadGrant, contextId: otherSponsorId };

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  requests = [];
  authority([]);
  mocks.scanner.mockClear();
  mocks.location = "/events/summit";
  location.hash = "#/events/summit";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      requests.push(url.pathname + url.search);
      let body: unknown = { event: event() };
      if (url.pathname.endsWith("/agenda/participation"))
        body = personalAgendaResponseSchema.parse({
          sessions: [
            {
              id: sessionId,
              publishedRevision: 1,
              title: "Published session",
              timeZone: "UTC",
              startAt: null,
              endAt: null,
              admissionPolicy: "optional_reservation",
              status: null,
              attendanceMode: null,
            },
          ],
          page: { limit: 1, offset: 0, total: 1, hasMore: false },
        });
      if (url.pathname.endsWith("/scans/targets"))
        body = scannerTargetsResponseSchema.parse({
          timeZone: "UTC",
          serverNow: "2026-10-07T12:00:00.000Z",
          rooms: [],
          roomsTruncated: false,
          sessions: [
            {
              id: sessionId,
              title: "Published session",
              startAt: null,
              endAt: null,
              rooms: roomIds.map((id, index) => ({ id, name: `Room ${index + 1}` })),
            },
          ],
          page: { limit: 1, offset: 0, total: 1, hasMore: false },
        });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => {
  render(null, host);
  host.remove();
  portalSession.value = null;
  vi.unstubAllGlobals();
});

describe("permission-derived attendee scanner navigation", () => {
  it("opens an attendee's event home before capture and keeps multi-sponsor selection explicit", () => {
    const participant = event();
    participant.participation = {
      registrationId: roomIds[0]!,
      registrationStatus: "registered",
      proposals: 0,
      speakerProposals: 0,
      proposalStates: [],
      speakerStates: [],
    };
    expect(eventDestination(participant)).toBe("#/events/summit");
    const scannerOnly = event();
    if (scannerOnly.scannerAccess) scannerOnly.scannerAccess.canScan = false;
    expect(eventDestination(scannerOnly)).toBe("#/events/summit/lead-scanner");
  });
  it("does not grant scanners from attendee standing or stale discovery alone", async () => {
    await act(() => render(<ParticipantEvent event={event()} />, host));
    expect(host.textContent).not.toContain("Badge scanner");
    expect(host.textContent).not.toContain("Lead scanner");
    expect(requests).toEqual([]);
  });
  it("does not inherit global or event lead grants into an exact sponsor scope", async () => {
    const session = portalSessionFixture({
      member: true,
      staff: true,
      grants: [
        { permission: "agenda:leads_capture", contextType: null, contextId: null },
        { permission: "agenda:leads_capture", contextType: "event", contextId: eventId },
      ],
    });
    await act(() => {
      portalSession.value = session;
      render(<ParticipantEvent event={event()} tab="lead-scanner" />, host);
    });
    expect(host.querySelector(`a[href="#/events/summit/sponsors/${sponsorId}/scanner"]`)).toBeNull();
    expect(host.textContent).toContain("Lead scanning is not available");
    expect(requests).toEqual([]);
  });
  it("keeps independent badge and lead entries and removes revoked authority", async () => {
    authority([badgeGrant, leadGrant]);
    await act(() => render(<ParticipantEvent event={event()} />, host));
    expect(host.querySelectorAll('nav[aria-label="Event"]')).toHaveLength(1);
    expect(host.querySelector('a[href="#/events/summit/scanner"]')?.textContent).toBe("Badge scanner");
    expect(host.querySelector(`a[href="#/events/summit/sponsors/${sponsorId}/scanner"]`)?.textContent).toBe(
      "Lead scanner",
    );
    await act(() => authority([badgeGrant]));
    expect(host.textContent).toContain("Badge scanner");
    expect(host.textContent).not.toContain("Lead scanner");
    await act(() => authority([]));
    expect(host.textContent).not.toContain("Badge scanner");
    expect(requests).toEqual([]);
  });
  it("offers every authorized sponsor explicitly instead of selecting the first", async () => {
    authority([badgeGrant, leadGrant, otherLeadGrant]);
    await act(() => render(<ParticipantEvent event={event()} tab="lead-scanner" />, host));
    expect(host.querySelector('a[href="#/events/summit/lead-scanner"]')).not.toBeNull();
    expect(host.querySelector(`a[href="#/events/summit/sponsors/${sponsorId}/scanner"]`)?.textContent).toBe(
      "First sponsor",
    );
    expect(host.querySelector(`a[href="#/events/summit/sponsors/${otherSponsorId}/scanner"]`)?.textContent).toBe(
      "Second sponsor",
    );
    expect(requests).toEqual([]);
  });
  it("refuses a discovery-only scanner route without loading its capture UI", async () => {
    await act(() => render(<EventWorkspace view="detail" slug="summit" tab="scanner" />, host));
    await vi.waitFor(() => expect(host.textContent).toContain("does not have permission"));
    expect(mocks.scanner).not.toHaveBeenCalled();
    expect(requests).toEqual(["/api/v1/events/summit"]);
  });
  it("forwards the exact session only after live badge permission and rejects malformed selection", async () => {
    authority([badgeGrant]);
    location.hash = `#/events/summit/scanner?session=${sessionId}`;
    await act(() => render(<EventWorkspace view="detail" slug="summit" tab="scanner" />, host));
    await vi.waitFor(() => expect(mocks.scanner).toHaveBeenCalled());
    expect(mocks.scanner.mock.calls[0]![0]).toMatchObject({
      occurrenceId: sessionId,
      allowedActions: ["attendance", "checkout"],
    });
    await act(() => render(null, host));
    mocks.scanner.mockClear();
    location.hash = "#/events/summit/scanner?session=not-a-session";
    await act(() => render(<EventWorkspace view="detail" slug="summit" tab="scanner" />, host));
    await vi.waitFor(() => expect(host.textContent).toContain("not available for check-in"));
    expect(mocks.scanner).not.toHaveBeenCalled();
  });
  it("adds a session check-in link only to authorized staff and removes it after revocation", async () => {
    authority([badgeGrant]);
    await act(() =>
      render(
        <SessionParticipation
          slug="summit"
          eventId={eventId}
          occurrenceId={sessionId}
          backHref="#/events/summit/agenda"
        />,
        host,
      ),
    );
    await vi.waitFor(() => expect(host.textContent).toContain("Start session check-in"));
    expect(host.querySelector(`a[href="#/events/summit/scanner?session=${sessionId}"]`)).not.toBeNull();
    await act(() => authority([leadGrant]));
    expect(host.textContent).not.toContain("Start session check-in");
    expect(requests.every((path) => path.includes("/agenda/participation?"))).toBe(true);
  });
  it("resolves the preselected session and requires an explicit physical room for a multiroom target", async () => {
    function Target() {
      const target = useScannerLocation("summit", sessionId, true, () => {});
      return (
        <ScannerLocationSelect
          slug="summit"
          targetId={target.targetId}
          label={target.targetLabel}
          rooms={target.rooms}
          roomId={target.roomId}
          targetField={{}}
          roomField={{}}
          onTarget={target.selectTarget}
          onRoom={target.selectRoom}
        />
      );
    }
    await act(() => render(<Target />, host));
    await vi.waitFor(() => expect(host.querySelector('select[name="roomId"]')).not.toBeNull());
    const room = host.querySelector<HTMLSelectElement>('select[name="roomId"]')!;
    expect(room.value).toBe("");
    expect(room.required).toBe(true);
    expect(requests).toContain(`/api/v1/events/summit/scans/targets?occurrenceId=${sessionId}&limit=1`);
    await act(() => {
      room.value = roomIds[1]!;
      room.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(room.value).toBe(roomIds[1]);
  });
});
