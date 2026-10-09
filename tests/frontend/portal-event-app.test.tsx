// @vitest-environment jsdom
import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personalAgendaResponseSchema } from "../../assets/shared/schemas/event-personal-agenda";
import { registrationManageReadResponseSchema } from "../../assets/shared/schemas/registration";
import { currentBadgeResponseSchema } from "../../assets/shared/schemas/route-contracts-event-current-badge";
import { badgeFaceBadge, badgeFacePrinting } from "./helpers/badge-face-fixture";
import { ParticipantEvent } from "../../assets/ts/member-flows/portal/sections/events/ParticipantEvent";
import { PortalNavigationShell } from "../../assets/ts/member-flows/portal/shell/PortalNavigationShell";
import { portalAppTabForLocation, portalAppTabs } from "../../assets/ts/member-flows/portal/shell/portal-app-tabs";
import { pickEventNow } from "../../assets/ts/member-flows/portal/sections/events/app/useEventNow";
import { eventPhase } from "../../assets/ts/member-flows/portal/sections/events/app/event-timing";
import {
  eventPlaceSummary,
  eventVenueLines,
  type ParticipantEventDetail,
} from "../../assets/ts/member-flows/portal/sections/events/app/event-app-model";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import {
  participantEventFixture,
  participantEventId,
  participantRegistrationId,
  registeredParticipant,
} from "../helpers/participant-event";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={`#${href}`} {...props}>
      {children}
    </a>
  ),
}));
const currentLocation = { value: "/home" };
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => [currentLocation.value, vi.fn()] }));

const eventId = participantEventId;
const registrationId = participantRegistrationId;
const sessionIds = ["a0000000-0000-4000-8000-000000000011", "a0000000-0000-4000-8000-000000000012"];
const NOW = Date.parse("2026-12-01T10:00:00.000Z");
let host: HTMLDivElement;
let requests: string[];

const event = participantEventFixture;

const registered = registeredParticipant;

function agendaSession(id: string, title: string, startAt: string, endAt: string, status: string | null) {
  return {
    id,
    publishedRevision: 1,
    title,
    timeZone: "Europe/Amsterdam",
    startAt,
    endAt,
    rooms: [{ id: sessionIds[0], name: "Blue hall" }],
    admissionPolicy: "optional_reservation",
    status,
    attendanceMode: null,
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  currentLocation.value = "/home";
  host = document.createElement("div");
  document.body.append(host);
  requests = [];
  portalSession.value = portalSessionFixture({ member: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), location.origin);
      requests.push(url.pathname + url.search);
      if (url.pathname.endsWith("/agenda/participation/program")) return json({ agenda: null, marks: [] });
      if (url.pathname.endsWith("/agenda/participation"))
        return json(
          personalAgendaResponseSchema.parse({
            sessions: [
              agendaSession(
                sessionIds[0]!,
                "Opening keynote",
                "2026-12-01T09:30:00.000Z",
                "2026-12-01T10:30:00.000Z",
                null,
              ),
              agendaSession(
                sessionIds[1]!,
                "Migration panel",
                "2026-12-01T13:00:00.000Z",
                "2026-12-01T14:00:00.000Z",
                "reserved",
              ),
            ],
            page: { limit: 100, offset: 0, total: 2, hasMore: false },
          }),
        );
      if (url.pathname === "/api/v1/events/summit/badges/current") {
        expect(init?.method).toBe("PUT");
        return json(
          currentBadgeResponseSchema.parse({
            badge: {
              ...(await badgeFaceBadge()),
              printingRevision: badgeFacePrinting().revision,
              expiresAt: "2026-12-04T00:00:00.000Z",
            },
            printing: badgeFacePrinting(),
          }),
        );
      }
      if (url.pathname === `/api/v1/registrations/${registrationId}`)
        return json(
          registrationManageReadResponseSchema.parse({
            success: true,
            sponsorSharing: { allowed: false, withdrawnAt: null },
            registration: {
              id: registrationId,
              event_id: eventId,
              status: "registered",
              cancellation_reason_code: null,
              attendance_type: "in_person",
              custom_answers: null,
              isEmailVerified: true,
            },
            event: { id: eventId, slug: "summit", name: "Summit" },
            user: {
              email: "femke@example.test",
              first_name: "Femke",
              last_name: "de Vries",
              organization_name: "Ministry of the Interior",
              job_title: null,
            },
            eventDays: [],
            dayAttendance: [],
            dayWaitlist: [],
            shareUrl: null,
            headshotUrl: null,
          }),
        );
      throw new Error(`Unexpected request: ${url.pathname}`);
    }),
  );
});

afterEach(() => {
  render(null, host);
  host.remove();
  portalSession.value = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function tabLabels(label: string): string[] {
  return [...host.querySelectorAll(`nav[aria-label="${label}"] :is(a, button)`)].map((link) =>
    (link.textContent ?? "").replace(" (public event page)", ""),
  );
}

describe("portal-wide bottom tabs", () => {
  it("offers Home, Events, Groups and Me to a participating member and marks the open section", async () => {
    currentLocation.value = "/events";
    await act(() =>
      render(
        <PortalNavigationShell
          session={{ ...portalSessionFixture({ member: true }), eventParticipation: true }}
          displayName="Femke"
          headshotUrl={null}
        >
          <p>Page</p>
        </PortalNavigationShell>,
        host,
      ),
    );
    expect(tabLabels("App")).toEqual(["Home", "Events", "Groups", "Me"]);
    expect(host.querySelector('nav[aria-label="App"] [aria-current="page"]')?.textContent).toBe("Events");
  });

  it("leaves Groups out for an identity without group access", () => {
    const attendee = { ...portalSessionFixture({}), eventParticipation: true };
    expect(portalAppTabs(attendee).map((tab) => tab.label)).toEqual(["Home", "Events", "Me"]);
    expect(portalAppTabForLocation(attendee, `/users/${attendee.identity.id}`)).toBe("me");
    expect(portalAppTabForLocation(attendee, "/account")).toBe("me");
    expect(portalAppTabForLocation(attendee, "/events/summit/agenda")).toBe("events");
  });
});

describe("event bottom tabs", () => {
  it("shows an attendee's tabs, opens More as a sheet, and files pages without a tab under More", async () => {
    await act(() => render(<ParticipantEvent event={event(registered)} tab="more" />, host));
    expect(tabLabels("Event app")).toEqual(["Home", "Agenda", "My agenda", "Ticket", "More"]);
    const bar = host.querySelector('nav[aria-label="Event app"]')!;
    // More opens the sheet; on a page without a tab it is the current one.
    const more = bar.querySelector<HTMLButtonElement>('button[data-app-tab="more"]')!;
    expect(more.getAttribute("aria-current")).toBe("page");
    expect(more.getAttribute("aria-haspopup")).toBe("dialog");
    // Agenda stays in the app: the whole programme, and the same view pre-filtered to the reader's sessions.
    expect(bar.querySelector('[data-app-tab="programme"]')?.getAttribute("href")).toBe("#/events/summit/agenda");
    expect(bar.querySelector('[data-app-tab="agenda"]')?.getAttribute("href")).toBe("#/events/summit/agenda?mine=1");
    expect(bar.querySelector('[data-app-tab="ticket"]')?.getAttribute("href")).toBe("#/events/summit/ticket");
    // Each tab has a decorative glyph over its label; the label stays the accessible name.
    for (const tab of bar.querySelectorAll("a, button"))
      expect(tab.querySelector("svg.pk-app-tabbar__icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(tabLabels("Event")).toEqual(["Overview", "Agenda", "My agenda", "Ticket", "Registration"]);
    // The desktop tabs remain the page's one "Event" navigation.
    expect(host.querySelectorAll('nav[aria-label="Event"]')).toHaveLength(1);
    expect(host.querySelector('[data-event-more="registration"]')?.getAttribute("href")).toBe(
      `#/events/summit/registrations/${registrationId}`,
    );
    expect(host.querySelector('[data-event-more="scanner"]')).toBeNull();
    expect(host.querySelector('[data-event-more="proposals"]')).toBeNull();
  });
});

describe("event home", () => {
  it("opens with the event hero and offers registration to a reader who is not registered", async () => {
    await act(() => render(<ParticipantEvent event={event()} />, host));
    expect(host.querySelector(".pk-event-hero__title")?.textContent).toBe("Summit");
    expect(host.textContent).toContain("Amsterdam");
    const register = [...host.querySelectorAll("a")].find((link) => link.textContent === "Register");
    expect(register?.getAttribute("href")).toBe("/events/summit/register/");
    expect(host.textContent).not.toContain("Show ticket");
    expect(host.textContent).not.toContain("Your proposals");
    expect(requests).toEqual([]);
  });

  it("explains an invitation-only event instead of offering a registration link", async () => {
    await act(() =>
      render(
        <ParticipantEvent event={event({ registrationPolicy: "invitation_only", registrationPath: null })} />,
        host,
      ),
    );
    expect(host.textContent).toContain("by invitation only");
    expect([...host.querySelectorAll("a")].some((link) => link.textContent === "Register")).toBe(false);
  });

  it("shows a registered attendee's ticket card and proposals card", async () => {
    const speaker = event({
      ...registered,
      participation: { ...registered.participation, proposals: 1, speakerProposals: 1 },
    });
    await act(() => render(<ParticipantEvent event={speaker} />, host));
    expect(host.textContent).toContain("Your ticket");
    expect(host.textContent).toContain("Registered");
    expect(host.querySelector('a[href="#/events/summit/ticket"]')).not.toBeNull();
    expect(host.textContent).toContain("Your proposals");
    expect(host.textContent).toContain("1 submitted");
    expect([...host.querySelectorAll("a")].some((link) => link.textContent === "Register")).toBe(false);
  });

  it("shows the reader's next session and what is live during the event", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const live = event({ ...registered, startsAt: "2026-12-01T08:00:00.000Z", endsAt: "2026-12-03T17:00:00.000Z" });
    await act(() => render(<ParticipantEvent event={live} />, host));
    await vi.waitFor(() => expect(host.textContent).toContain("Migration panel"));
    expect(host.querySelector(".pk-event-hero__status")?.textContent).toBe("Live now");
    expect(host.textContent).toContain("Your next session");
    expect(host.textContent).toContain("Reserved");
    const liveList = host.querySelector('[aria-label="Sessions running now"]');
    expect(liveList?.textContent).toContain("Opening keynote");
    expect(liveList?.textContent).toContain("Blue hall");
    // Two bounded, server-filtered reads instead of walking the whole programme.
    const from = encodeURIComponent(new Date(NOW).toISOString());
    expect(requests).toEqual([
      `/api/v1/events/summit/agenda/participation?sort=startAt&from=${from}&limit=5`,
      `/api/v1/events/summit/agenda/participation?sort=startAt&from=${from}&mine=true&limit=1`,
    ]);
  });

  it("renders the ticket as the printed badge front, with the holder's own QR code and the sponsors", async () => {
    await act(() => render(<ParticipantEvent event={event(registered)} tab="ticket" />, host));
    await vi.waitFor(() => expect(host.querySelector("iframe.pk-badge-face__frame")).not.toBeNull());
    expect(host.querySelector(".pk-badge-face--portrait")?.getAttribute("data-badge-height-mm")).toBe("148");
    const face = host.querySelector("iframe.pk-badge-face__frame")!;
    expect(face.getAttribute("title")).toBe("Your badge for Summit");
    const document = face.getAttribute("srcdoc") ?? "";
    expect(document).toContain("Femke");
    expect(document).toContain("Ministry of the Interior");
    expect(document).toContain("badge-template-qr");
    expect(document).toContain(encodeURIComponent("ABCD-EFGH-JKLM-NPQR"));
    expect(document).toContain('aria-label="Synthetic Sponsor"');
    expect(host.textContent).not.toContain("Check-in code on your printed badge");
    expect(requests).toEqual(["/api/v1/events/summit/badges/current"]);
  });

  it("asks an unconfirmed registration to confirm before any badge is issued", async () => {
    const pending = {
      viewer: { ...registered.viewer, registrationStatus: "pending_email_confirmation" },
      participation: { ...registered.participation, registrationStatus: "pending_email_confirmation" },
    };
    await act(() => render(<ParticipantEvent event={event(pending)} tab="ticket" />, host));
    expect(host.textContent).toContain("Confirm your registration");
    expect(host.querySelector("iframe")).toBeNull();
    expect(requests).toEqual([]);
  });

  it("offers registration on the ticket tab to a reader without one", async () => {
    await act(() => render(<ParticipantEvent event={event()} tab="ticket" />, host));
    expect(host.textContent).toContain("No ticket yet");
    expect(host.querySelector('a[href="/events/summit/register/"]')).not.toBeNull();
    expect(requests).toEqual([]);
  });
});

describe("event app agenda and pages", () => {
  it.each([
    ["/events/summit/agenda", "Agenda", "programme"],
    ["/events/summit/agenda?mine=1", "My agenda", "agenda"],
  ])("opens %s as the %s tab with the compact app header", async (location, title, tab) => {
    currentLocation.value = location;
    await act(() => render(<ParticipantEvent event={event(registered)} tab="agenda" />, host));
    expect(host.querySelector('nav[aria-label="Event app"] [aria-current="page"]')?.getAttribute("data-app-tab")).toBe(
      tab,
    );
    expect(host.querySelector(".pk-event-hero--compact .pk-event-hero__title")?.textContent).toBe(title);
    await vi.waitFor(() => expect(requests).toContain("/api/v1/events/summit/agenda/participation/program"));
  });

  it("titles a sub-page by itself and names the event once, as the way back", async () => {
    await act(() => render(<ParticipantEvent event={event(registered)} tab="more" />, host));
    const header = host.querySelector(".pk-event-hero--compact")!;
    expect(header.querySelector(".pk-event-hero__title")?.textContent).toBe("More");
    const back = header.querySelector<HTMLAnchorElement>(".pk-event-hero__back")!;
    expect(back.getAttribute("href")).toBe("#/events/summit");
    expect(back.textContent).toContain("Summit");
    expect(header.textContent?.match(/Summit/g)).toHaveLength(1);
  });

  it("offers Submit a proposal on the home only while the call for proposals is open", async () => {
    await act(() =>
      render(
        <ParticipantEvent event={event({ proposalCall: { open: true, path: "/events/summit/proposal/" } })} />,
        host,
      ),
    );
    const submit = [...host.querySelectorAll("a")].find((link) => link.textContent === "Submit a proposal");
    expect(submit?.getAttribute("href")).toBe("/events/summit/proposal/");
    render(null, host);
    await act(() => render(<ParticipantEvent event={event({ proposalCall: { open: false, path: null } })} />, host));
    expect(host.textContent).not.toContain("Submit a proposal");
  });

  it("names the venue and city once and keeps the full address for the venue details", () => {
    const managed = {
      ...event(),
      venue: "Meervaart, Meer en Vaart 300, 1068 LE, Amsterdam, Netherlands",
      location: "Amsterdam, The Netherlands",
    } as ParticipantEventDetail;
    expect(eventPlaceSummary(managed)).toBe("Meervaart · Amsterdam");
    expect(eventVenueLines(managed)).toEqual(["Meervaart, Meer en Vaart 300, 1068 LE, Amsterdam, Netherlands"]);
    expect(eventVenueLines({ ...managed, location: "Amstelveen, The Netherlands" })).toEqual([
      "Meervaart, Meer en Vaart 300, 1068 LE, Amsterdam, Netherlands",
      "Amstelveen, The Netherlands",
    ]);
    expect(eventPlaceSummary({ ...event(), location: "Amsterdam" })).toBe("Amsterdam");
  });
});

describe("event timing", () => {
  it("names the event's phase relative to now", () => {
    expect(eventPhase(null, null).kind).toBe("unscheduled");
    expect(eventPhase("2026-12-01T08:00:00.000Z", "2026-12-03T17:00:00.000Z", NOW).label).toBe("Live now");
    expect(eventPhase("2026-11-01T08:00:00.000Z", "2026-11-02T17:00:00.000Z", NOW).label).toBe("Ended");
    expect(eventPhase(new Date(Date.now() + 3 * 86_400_000).toISOString(), null).label).toBe("Starts in 3 days");
  });

  it("picks the reader's next unfinished session, not one that has ended", () => {
    const sessions = personalAgendaResponseSchema.parse({
      sessions: [
        agendaSession(sessionIds[0]!, "Done", "2026-12-01T08:00:00.000Z", "2026-12-01T09:00:00.000Z", "reserved"),
        agendaSession(sessionIds[1]!, "Next", "2026-12-01T11:00:00.000Z", "2026-12-01T12:00:00.000Z", "saved"),
      ],
      page: { limit: 100, offset: 0, total: 2, hasMore: false },
    }).sessions;
    expect(pickEventNow(sessions, NOW).next?.title).toBe("Next");
    expect(pickEventNow(sessions, NOW).live).toEqual([]);
  });
});
