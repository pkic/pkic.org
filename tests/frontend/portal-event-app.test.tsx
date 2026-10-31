import { eventPlaceSummary } from "../../assets/shared/event-place";
// @vitest-environment jsdom
import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personalAgendaResponseSchema } from "../../assets/shared/schemas/event-personal-agenda";
import { registrationManageReadResponseSchema } from "../../assets/shared/schemas/registration";
import { currentBadgeResponseSchema } from "../../assets/shared/schemas/route-contracts-event-current-badge";
import { currentAttendanceResponseSchema } from "../../assets/shared/schemas/event-attendance-points";
import { badgeFaceBadge, badgeFacePrinting } from "./helpers/badge-face-fixture";
import { ParticipantEvent } from "../../assets/ts/member-flows/portal/sections/events/ParticipantEvent";
import { PortalNavigationShell } from "../../assets/ts/member-flows/portal/shell/PortalNavigationShell";
import { portalAppTabForLocation, portalAppTabs } from "../../assets/ts/member-flows/portal/shell/portal-app-tabs";
import { pickEventNow } from "../../assets/ts/member-flows/portal/sections/events/app/useEventNow";
import { eventPhase } from "../../assets/ts/member-flows/portal/sections/events/app/event-timing";
import { formatDateTimeInZone } from "../../assets/shared/format-date";
import {
  eventVenueLines,
  type ParticipantEventDetail,
} from "../../assets/ts/member-flows/portal/sections/events/app/event-app-model";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { PERSONAL_ADDRESS_FOLLOW_UP_COPY } from "../../assets/shared/email-first-copy";
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
const navigateHash = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => [currentLocation.value, navigateHash] }));

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
  navigateHash.mockReset();
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
      if (url.pathname === "/api/v1/events/summit/attendance/check-ins/current")
        return json(
          currentAttendanceResponseSchema.parse({
            dayDate: "2026-12-01",
            dayLabel: "Day 1",
            venue: "checked_in",
            changedAt: "2026-12-01T08:12:00.000Z",
            lastSession: null,
            timeZone: "Europe/Amsterdam",
            clockCity: "Amsterdam",
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
            waitlistHandledLast: false,
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
    // Agenda stays in the app: the whole program, and the same view pre-filtered to the reader's sessions.
    expect(bar.querySelector('[data-app-tab="program"]')?.getAttribute("href")).toBe("#/events/summit/agenda");
    expect(bar.querySelector('[data-app-tab="agenda"]')?.getAttribute("href")).toBe("#/events/summit/agenda?mine=1");
    expect(bar.querySelector('[data-app-tab="ticket"]')?.getAttribute("href")).toBe("#/events/summit/ticket");
    // Each tab has a decorative glyph over its label; the label stays the accessible name.
    for (const tab of bar.querySelectorAll("a, button"))
      expect(tab.querySelector("svg.pk-app-tabbar__icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(tabLabels("Event")).toEqual([
      "Overview",
      "Agenda",
      "My agenda",
      "Ticket",
      "Virtual room",
      "Registration",
      "Share",
    ]);
    expect(host.querySelector('[data-event-more="promotion"]')?.getAttribute("href")).toBe("#/events/summit/promotion");
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
    const register = host.querySelector<HTMLAnchorElement>('a[href="#/events/summit/register/"]');
    expect(register).toBeTruthy();
    expect(host.querySelector('a[href="/events/summit/register/"]')).toBeNull();
    const card = register!.closest(".pk-event-card")!;
    expect(card.querySelector(".pk-event-card__eyebrow")?.textContent).toBe("Registration");
    expect(card.querySelector(".pk-event-card__title")?.textContent).toBe("You're not registered yet");
    // Kicker, title and button say it all; no body repeats them.
    expect(card.querySelectorAll("p:not(.pk-event-card__eyebrow)")).toHaveLength(0);
    expect(host.textContent).not.toContain("Show ticket");
    expect(host.textContent).not.toContain("Your proposals");
    expect(host.textContent).not.toContain("Your next session");
    expect(tabLabels("Event app")).not.toContain("My agenda");
    expect(requests).toEqual([]);
  });

  it("leads an organizer from the app's header to the workspace where the event is managed", async () => {
    const groupId = "20000000-0000-4000-8000-000000000003";
    const managed = { ...event(), capabilities: ["read", "write"], ownerGroupId: groupId };
    await act(() => render(<ParticipantEvent event={managed as never} />, host));
    const manage = [...host.querySelectorAll("a")].find((link) => link.textContent === "Manage event");
    expect(manage?.getAttribute("href")).toContain(`/groups/${groupId}/events/${eventId}`);
  });

  it("offers an attendee no way into management", async () => {
    await act(() => render(<ParticipantEvent event={event()} />, host));
    expect([...host.querySelectorAll("a")].some((link) => link.textContent === "Manage event")).toBe(false);
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

  it("leaves registration off the home of an event that has ended", async () => {
    await act(() =>
      render(
        <ParticipantEvent
          event={event({ startsAt: "2025-12-01T08:00:00.000Z", endsAt: "2025-12-03T17:00:00.000Z" })}
        />,
        host,
      ),
    );
    expect(host.querySelector(".pk-event-hero__status")?.textContent).toBe("Ended");
    expect(host.textContent).not.toContain("Registration");
    expect(host.textContent).not.toContain("has ended");
  });

  it("shows a registered attendee's ticket card and proposals card", async () => {
    const speaker = event({
      ...registered,
      participation: { ...registered.participation, proposals: 1, speakerProposals: 1 },
    });
    await act(() => render(<ParticipantEvent event={speaker} />, host));
    expect(host.textContent).toContain("Your ticket");
    expect(host.textContent).toContain("You're registered");
    // The title already says so; no status badge repeats it.
    expect(host.querySelector(".pk-event-card .pk-badge")).toBeNull();
    // A registration without days holds its type for the whole event.
    expect(host.querySelector(".pk-event-card__meta")?.textContent).toBe("In person");
    expect(host.querySelector('a[href="#/events/summit/ticket"]')).not.toBeNull();
    expect(host.textContent).toContain("Your proposals");
    expect(host.textContent).toContain("1 submitted");
    expect([...host.querySelectorAll("a")].some((link) => link.textContent === "Register")).toBe(false);
  });

  it.each([
    [false, true],
    [true, false],
  ])(
    "follows the server's work-address verdict for the add-a-work-address prompt (holds one: %s)",
    async (holdsWorkAddress, prompted) => {
      // The signed-in address is personal either way; only the verdict over every verified address decides.
      portalSession.value = {
        ...portalSessionFixture({ member: true }),
        identity: { ...portalSessionFixture({ member: true }).identity, email: "ada@gmail.com" },
      };
      await act(() =>
        render(
          <ParticipantEvent event={event({ ...registered, viewer: { ...registered.viewer, holdsWorkAddress } })} />,
          host,
        ),
      );
      expect(host.textContent?.includes(PERSONAL_ADDRESS_FOLLOW_UP_COPY.title)).toBe(prompted);
    },
  );

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
    // On an event day the home says whether the attendee is checked in, on the event clock.
    await vi.waitFor(() => expect(host.textContent).toContain("You're checked in"));
    expect(host.textContent).toContain("Since 09:12");
    // Two bounded, server-filtered agenda reads instead of walking the whole program, and today's check-in.
    const from = encodeURIComponent(new Date(NOW).toISOString());
    expect([...requests].sort()).toEqual(
      [
        `/api/v1/events/summit/agenda/participation?sort=startAt&from=${from}&limit=5`,
        `/api/v1/events/summit/agenda/participation?sort=startAt&from=${from}&mine=true&limit=1`,
        "/api/v1/events/summit/attendance/check-ins/current",
      ].sort(),
    );
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

  it("keeps sharing and promotion materials out of Ticket", async () => {
    const detail = event(registered);
    detail.participation!.promotion = { sharePath: "/r/ownshare", badgeVersion: "2026-12-01T10:00:00.000Z" };
    await act(() => render(<ParticipantEvent event={detail} tab="ticket" />, host));
    await vi.waitFor(() => expect(host.querySelector("iframe.pk-badge-face__frame")).not.toBeNull());
    expect(host.querySelector("[data-og-badge-img]")).toBeNull();
    expect(host.textContent).not.toContain("Invite a colleague");
    expect(host.textContent).not.toContain("Prepare downloads");
    expect(requests).toEqual(["/api/v1/events/summit/badges/current"]);
  });

  describe("an attendee waiting for an in-person seat", () => {
    // In-person on Dec 1 and 2 (both waitlisted), online on Dec 3: the registration-level type is in_person.
    const waiting = {
      ...registered,
      startsAt: "2026-12-01T08:00:00.000Z",
      endsAt: "2026-12-03T17:00:00.000Z",
      viewer: {
        ...registered.viewer,
        waitlisted: true,
        days: [
          { date: "2026-12-01", attendanceType: "in_person", state: "waitlisted" },
          { date: "2026-12-02", attendanceType: "in_person", state: "waitlisted" },
          { date: "2026-12-03", attendanceType: "virtual", state: "registered" },
        ],
      },
    };

    it("is never told they hold a seat on the event home", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.parse("2026-11-01T10:00:00.000Z"));
      await act(() => render(<ParticipantEvent event={event(waiting)} />, host));
      const welcome = host.querySelector(".pk-event-welcome__standing")?.textContent ?? "";
      expect(welcome).toMatch(/^On the waiting list for Tue.*1.* and Wed.*2.* · Virtual on Thu.*3/);
      expect(host.textContent).not.toContain("Release your seat");
      expect(host.textContent).not.toContain("Can't attend in person?");
      expect(host.querySelector(".pk-event-card__meta")?.textContent).toMatch(/^Virtual .*3 · Waitlisted in person /);
    });

    it("offers to release a seat only for a confirmed in-person day", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.parse("2026-11-01T10:00:00.000Z"));
      const seated = {
        ...waiting,
        viewer: {
          ...waiting.viewer,
          days: [{ ...waiting.viewer.days[0], state: "registered" }, ...waiting.viewer.days.slice(1)],
        },
      };
      await act(() => render(<ParticipantEvent event={event(seated)} />, host));
      expect(host.textContent).toContain("Can't attend in person?");
    });

    it("explains on the ticket that the code admits them only once a seat is theirs", async () => {
      await act(() => render(<ParticipantEvent event={event(waiting)} tab="ticket" />, host));
      await vi.waitFor(() => expect(host.querySelector("iframe.pk-badge-face__frame")).not.toBeNull());
      const card = host.querySelector(".pk-event-card");
      expect(card?.textContent).toContain("No in-person seat yet");
      expect(card?.textContent).toMatch(/waiting list for Tue.*1.* and Wed.*2/);
      expect(card?.textContent).toMatch(/On Thu.*3 you join online/);
      expect(host.textContent).not.toContain("Show this QR code at the entrance");
      // The explanation comes before the badge, so the code is not read as admission.
      expect(
        card!.compareDocumentPosition(host.querySelector("iframe")!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("asks an unconfirmed registration to confirm before any badge is issued", async () => {
    const pending = {
      viewer: { ...registered.viewer, registrationStatus: "pending_email_confirmation" },
      participation: { ...registered.participation, registrationStatus: "pending_email_confirmation" },
    };
    await act(() => render(<ParticipantEvent event={event(pending)} tab="ticket" />, host));
    expect(host.textContent).toContain("Confirm your email address");
    expect(host.querySelector("iframe")).toBeNull();
    expect(requests).toEqual([]);
  });

  it("sends a reader without a registration from the ticket page to the event home, where no Ticket tab is listed", async () => {
    await act(() => render(<ParticipantEvent event={event()} tab="ticket" />, host));
    expect(navigateHash).toHaveBeenCalledWith("/events/summit", { replace: true });
    expect(host.textContent).not.toContain("No ticket yet");
    expect(host.querySelector('a[href="#/events/summit/ticket"]')).toBeNull();
    expect(host.querySelector('a[href="#/events/summit/register/"]')).not.toBeNull();
    expect(requests).toEqual([]);
  });
});

describe("event app agenda and pages", () => {
  it.each([
    ["/events/summit/agenda", "Agenda", "program"],
    ["/events/summit/agenda?mine=1", "My agenda", "agenda"],
  ])("opens %s as the %s tab under the persistent event hero", async (location, title, tab) => {
    currentLocation.value = location;
    await act(() => render(<ParticipantEvent event={event(registered)} tab="agenda" />, host));
    expect(host.querySelector('nav[aria-label="Event app"] [aria-current="page"]')?.getAttribute("data-app-tab")).toBe(
      tab,
    );
    expect(host.querySelector(".pk-event-hero__title")?.textContent).toBe("Summit");
    expect(host.querySelector(".pk-event-hero--compact")).toBeNull();
    expect([...host.querySelectorAll("h1,h2,h3")].some((heading) => heading.textContent === title)).toBe(true);
    // The agenda tab's chunk (with the live room's questions and polls) loads cold on the first case.
    await vi.waitFor(() => expect(requests).toContain("/api/v1/events/summit/agenda/participation/program"), {
      timeout: 5_000,
    });
  });

  it("keeps event context above a sub-page's own heading", async () => {
    await act(() => render(<ParticipantEvent event={event(registered)} tab="more" />, host));
    const hero = host.querySelector(".pk-event-hero")!;
    expect(hero.querySelector(".pk-event-hero__title")?.textContent).toBe("Summit");
    const heading = [...host.querySelectorAll("h1,h2,h3")].find((node) => node.textContent === "More")!;
    expect(heading).toBeDefined();
    expect(hero.contains(heading)).toBe(false);
    expect(hero.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers Submit a proposal on the home only while the call for proposals is open", async () => {
    await act(() =>
      render(
        <ParticipantEvent
          event={event({
            timezone: "Europe/Amsterdam",
            proposalCall: { open: true, path: "/events/summit/proposal/", closesAt: "2026-11-15T22:59:00.000Z" },
          })}
        />,
        host,
      ),
    );
    const submit = [...host.querySelectorAll("a")].find((link) => link.textContent === "Submit a proposal");
    expect(submit?.getAttribute("href")).toBe("/events/summit/proposal/");
    const card = submit!.closest(".pk-event-card")!;
    // The close date, on the event's own clock, instead of repeating the kicker.
    expect(card.querySelector(".pk-event-card__meta")?.textContent).toBe(
      `Closes ${formatDateTimeInZone("2026-11-15T22:59:00.000Z", "Europe/Amsterdam")}`,
    );
    expect(card.textContent).not.toContain("is open");
    render(null, host);
    await act(() =>
      render(
        <ParticipantEvent
          event={event({ proposalCall: { open: true, path: "/events/summit/proposal/", closesAt: null } })}
        />,
        host,
      ),
    );
    expect(host.textContent).not.toContain("Closes");
    render(null, host);
    await act(() =>
      render(<ParticipantEvent event={event({ proposalCall: { open: false, path: null, closesAt: null } })} />, host),
    );
    expect(host.textContent).not.toContain("Submit a proposal");
  });

  it("names the venue and city once and keeps the full address for the venue details", () => {
    const managed = {
      ...event(),
      venue: "Meervaart, Meer en Vaart 300, 1068 LE, Amsterdam, Netherlands",
      city: "Amsterdam",
      country: "NL",
    } as ParticipantEventDetail;
    expect(eventPlaceSummary(managed)).toBe("Meervaart · Amsterdam");
    expect(eventVenueLines(managed)).toEqual(["Meervaart, Meer en Vaart 300, 1068 LE, Amsterdam, Netherlands"]);
    expect(eventVenueLines({ ...managed, city: "Amstelveen" })).toEqual([
      "Meervaart, Meer en Vaart 300, 1068 LE, Amsterdam, Netherlands",
      "Amstelveen, Netherlands",
    ]);
    expect(eventPlaceSummary({ ...event(), city: "Amsterdam" })).toBe("Amsterdam");
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
