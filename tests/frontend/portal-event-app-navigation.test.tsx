// @vitest-environment jsdom
import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParticipantEvent } from "../../assets/ts/member-flows/portal/sections/events/ParticipantEvent";
import {
  eventAppNavigation,
  eventAppTabFor,
  participantEventAppSubject,
} from "../../assets/ts/member-flows/portal/sections/events/app/event-app-tabs";
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
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/events/summit", vi.fn()] }));

const sponsorId = "a0000000-0000-4000-8000-000000000003";
const otherSponsorId = "a0000000-0000-4000-8000-000000000004";
const groupId = "a0000000-0000-4000-8000-000000000005";
const badgeGrant = { permission: "agenda:check", contextType: "event", contextId: participantEventId };
const leadGrant = { permission: "agenda:leads_capture", contextType: "event_sponsor", contextId: sponsorId };
const sponsorDiscovery = { canScan: false, sponsors: [{ id: sponsorId, name: "First sponsor" }] };
let host: HTMLDivElement;

function authority(grants: Array<{ permission: string; contextType: string | null; contextId: string | null }>) {
  portalSession.value = portalSessionFixture({ member: false, staff: true, grants });
}

function navigation(overrides: Parameters<typeof participantEventFixture>[0] = {}) {
  return eventAppNavigation(participantEventAppSubject(participantEventFixture(overrides)), portalSession.value);
}

const labels = (items: ReadonlyArray<{ label: string }>) => items.map((item) => item.label);
const ids = (items: ReadonlyArray<{ id: string }>) => items.map((item) => item.id);

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  portalSession.value = portalSessionFixture({});
  // jsdom has the element but not its modal behavior; mirror the platform's open state and close event.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unexpected request: ${String(input)}`);
    }),
  );
});

afterEach(() => {
  render(null, host);
  host.remove();
  portalSession.value = null;
  vi.unstubAllGlobals();
});

describe("event app tab selection", () => {
  it("gives a registered attendee My agenda and Ticket, and keeps everything else under More", () => {
    const { tabs, more } = navigation(registeredParticipant);
    expect(labels(tabs)).toEqual(["Home", "Agenda", "My agenda", "Ticket"]);
    expect(ids(more)).toEqual(["registration", "calendar", "venue", "event-page"]);
    expect(more.find((item) => item.id === "registration")?.href).toBe(
      `#/events/summit/registrations/${participantRegistrationId}`,
    );
    expect(more.find((item) => item.id === "calendar")?.href).toBe("#/events/summit/agenda?mine=1&view=calendar");
  });

  it("gives a reader without a registration no Ticket tab", () => {
    const { tabs, more } = navigation({ location: null });
    expect(labels(tabs)).toEqual(["Home", "Agenda", "My agenda"]);
    // Nothing about the venue to show, so no venue tile either.
    expect(ids(more)).toEqual(["calendar", "event-page"]);
  });

  it("puts the lead scanner on a sponsor representative's bar and moves My agenda to More", () => {
    authority([leadGrant]);
    const { tabs, more } = navigation({ ...registeredParticipant, scannerAccess: sponsorDiscovery });
    expect(labels(tabs)).toEqual(["Home", "Agenda", "Leads", "Ticket"]);
    expect(tabs.find((tab) => tab.id === "lead-scanner")?.href).toBe(`#/events/summit/sponsors/${sponsorId}/scanner`);
    expect(tabs.find((tab) => tab.id === "lead-scanner")?.icon).toBe("leads");
    expect(ids(more)).toContain("agenda");
    expect(ids(more)).not.toContain("lead-scanner");
  });

  it("lets a representative of several sponsors choose the sponsor first", () => {
    authority([leadGrant, { ...leadGrant, contextId: otherSponsorId }]);
    const { tabs } = navigation({
      scannerAccess: {
        canScan: false,
        sponsors: [...sponsorDiscovery.sponsors, { id: otherSponsorId, name: "Second" }],
      },
    });
    // Unregistered: My agenda takes the slot the ticket would have had.
    expect(labels(tabs)).toEqual(["Home", "Agenda", "Leads", "My agenda"]);
    expect(tabs.find((tab) => tab.id === "lead-scanner")?.href).toBe("#/events/summit/lead-scanner");
  });

  it("puts the badge scanner first for this event's own staff, ahead of a sponsor's lead scanner", () => {
    authority([badgeGrant, leadGrant]);
    const { tabs, more } = navigation({
      ...registeredParticipant,
      scannerAccess: { ...sponsorDiscovery, canScan: true },
    });
    expect(labels(tabs)).toEqual(["Home", "Agenda", "Scan", "Ticket"]);
    expect(tabs.find((tab) => tab.id === "scanner")?.href).toBe("#/events/summit/scanner");
    expect(tabs.find((tab) => tab.id === "scanner")?.icon).toBe("scan");
    expect(ids(more).slice(0, 2)).toEqual(["agenda", "lead-scanner"]);
    expect(labels(more).slice(0, 2)).toEqual(["My agenda", "Lead scanner"]);
  });

  it("offers no scanner from discovery alone or from another event's grant", () => {
    authority([{ ...badgeGrant, contextId: groupId }]);
    const { tabs, more } = navigation({ scannerAccess: { ...sponsorDiscovery, canScan: true } });
    expect(labels(tabs)).toEqual(["Home", "Agenda", "My agenda"]);
    expect(ids(more)).not.toContain("scanner");
    expect(ids(more)).not.toContain("lead-scanner");
  });

  it("adds the organizer workspace only for a reader who can open the owning group", () => {
    const managed = { ...participantEventFixture(), ownerGroupId: groupId };
    portalSession.value = { ...portalSessionFixture({ member: true }), eventParticipation: true };
    const workspace = eventAppNavigation(managed, portalSession.value).more.find((item) => item.id === "workspace");
    expect(workspace?.href).toBe(`#/groups/${groupId}/events/${participantEventId}`);
    authority([badgeGrant]);
    expect(ids(eventAppNavigation(managed, portalSession.value).more)).not.toContain("workspace");
  });

  it("lists a speaker's proposals, sessions and promotion kits under More", () => {
    const { more } = navigation({
      participation: { ...registeredParticipant.participation, proposals: 1, speakerProposals: 1 },
    });
    expect(ids(more)).toEqual(expect.arrayContaining(["proposals", "session-management", "promotion"]));
  });

  it("marks the scanner's own tab while scanning and files a page without a tab under More", () => {
    authority([badgeGrant]);
    const { tabs } = navigation({ scannerAccess: { canScan: true, sponsors: [] } });
    expect(eventAppTabFor("scanner", tabs)).toBe("scanner");
    expect(eventAppTabFor("lead-scanner", tabs)).toBe("more");
    expect(eventAppTabFor("overview", tabs)).toBe("home");
    expect(eventAppTabFor("registration", tabs)).toBe("more");
  });
});

function pointer(target: Element, type: string, clientY: number, clientX = 100) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX, clientY }));
}

describe("event app More sheet", () => {
  async function renderAttendee() {
    await act(() => render(<ParticipantEvent event={participantEventFixture(registeredParticipant)} />, host));
    const more = host.querySelector<HTMLButtonElement>('nav[aria-label="Event app"] button[data-app-tab="more"]')!;
    const sheet = document.getElementById(more.getAttribute("aria-controls")!) as HTMLDialogElement;
    return { more, sheet };
  }

  it("opens from the More button as a labelled dialog of destination tiles and closes on Escape", async () => {
    const { more, sheet } = await renderAttendee();
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(sheet.open).toBe(false);
    // Closed, it holds no copy of the destinations.
    expect(sheet.querySelector("[data-event-more]")).toBeNull();
    await act(() => more.click());
    expect(sheet.open).toBe(true);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(sheet.getAttribute("aria-labelledby")!)?.textContent).toBe("More");
    const tiles = [...sheet.querySelectorAll<HTMLAnchorElement>("[data-event-more]")];
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      "Registration",
      "Calendar and reminders",
      "Venue & links",
      "Event website",
    ]);
    for (const tile of tiles) expect(tile.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    // Escape is the platform's close request: the dialog's `cancel` event.
    await act(() => {
      sheet.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(sheet.open).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes from its Close button, a tap on the backdrop, and a followed tile", async () => {
    const { more, sheet } = await renderAttendee();
    await act(() => more.click());
    await act(() => sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(sheet.open).toBe(false);
    await act(() => more.click());
    await act(() => {
      sheet.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(sheet.open).toBe(false);
    await act(() => more.click());
    await act(() => sheet.querySelector<HTMLAnchorElement>('[data-event-more="registration"]')!.click());
    expect(sheet.open).toBe(false);
  });

  it("opens on a swipe up the tab bar and closes on a swipe down its handle", async () => {
    const { more, sheet } = await renderAttendee();
    const bar = host.querySelector(".pk-app-tabbar--event")!;
    const tab = bar.querySelector('[data-app-tab="programme"]')!;
    // A short or sideways movement stays a tap.
    await act(() => {
      pointer(tab, "pointerdown", 800);
      pointer(tab, "pointermove", 790, 160);
      pointer(tab, "pointerup", 790, 160);
    });
    expect(sheet.open).toBe(false);
    await act(() => {
      pointer(tab, "pointerdown", 800);
      pointer(tab, "pointermove", 780);
      pointer(tab, "pointerup", 740);
    });
    expect(sheet.open).toBe(true);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    // The swipe swallows the click it ends with, so it does not also follow the tab it started on.
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    tab.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const grip = sheet.querySelector(".pk-sheet__grip")!;
    // Dragged a little and let go: the sheet follows, then settles back open.
    await act(() => {
      pointer(grip, "pointerdown", 300);
      pointer(grip, "pointermove", 330);
    });
    expect(sheet.style.getPropertyValue("--pk-sheet-drag")).toBe("30px");
    await act(() => pointer(grip, "pointerup", 330));
    expect(sheet.open).toBe(true);
    expect(sheet.style.getPropertyValue("--pk-sheet-drag")).toBe("0px");
    await act(() => {
      pointer(grip, "pointerdown", 300);
      pointer(grip, "pointermove", 360);
      pointer(grip, "pointerup", 400);
    });
    expect(sheet.open).toBe(false);
  });

  it("shows a sponsor's lead scanner on the bar and My agenda in the sheet", async () => {
    authority([leadGrant]);
    await act(() =>
      render(
        <ParticipantEvent
          event={participantEventFixture({ ...registeredParticipant, scannerAccess: sponsorDiscovery })}
        />,
        host,
      ),
    );
    const bar = host.querySelector('nav[aria-label="Event app"]')!;
    expect([...bar.querySelectorAll("a, button")].map((tab) => tab.textContent)).toEqual([
      "Home",
      "Agenda",
      "Leads",
      "Ticket",
      "More",
    ]);
    await act(() => bar.querySelector<HTMLButtonElement>('[data-app-tab="more"]')!.click());
    expect(host.querySelector('dialog [data-event-more="agenda"]')?.getAttribute("href")).toBe(
      "#/events/summit/agenda?mine=1",
    );
  });
});
