// @vitest-environment jsdom
import { render } from "preact";
import { render as renderToString } from "preact-render-to-string";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { personalAgendaSessionSchema } from "../../assets/shared/schemas/event-personal-agenda";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { eventParticipationLink } from "../../assets/shared/event-participation-link";
import { confirmAction } from "../../assets/ts/components/ConfirmDialog";
import {
  SessionActionBar,
  sessionHasParticipationActions,
} from "../../assets/ts/member-flows/portal/sections/events/detail/participation/SessionActionBar";
import { SessionParticipationManager } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/SessionParticipation";
import { AgendaSession } from "../../assets/ts/site/AgendaSession";
import { SessionDetailsParticipation } from "../../assets/ts/site/AgendaParticipationControls";
import { ButtonLink } from "../../assets/ts/ui/Button";
import { IconScan } from "../../assets/ts/components/icons/app-navigation";
import type { ComponentChildren } from "preact";
import type { ContentAgendaDay } from "../../assets/shared/site-agenda";

vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: vi.fn(async () => true) }));

const SESSION = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const ROOM = "10000000-0000-4000-8000-000000000003";

function session(overrides: Record<string, unknown> = {}) {
  return personalAgendaSessionSchema.parse({
    id: SESSION,
    publishedRevision: 3,
    title: "Hands-on workshop",
    rooms: [{ id: ROOM, name: "Room A" }],
    timeZone: "UTC",
    startAt: "2027-01-20T09:00:00.000Z",
    endAt: "2027-01-20T10:00:00.000Z",
    admissionPolicy: "reservation",
    status: null,
    attendanceMode: null,
    availability: {
      attendanceMode: "physical",
      state: "available",
      message: "Seats are available.",
      bookingAction: "reserve",
    },
    ...overrides,
  });
}

const hosts: HTMLElement[] = [];
const bodies: ReturnType<typeof sessionParticipationRequestSchema.parse>[] = [];

function mount(value: ReturnType<typeof session>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(sessionParticipationRequestSchema.parse(JSON.parse(String(init?.body))));
      return Response.json(
        sessionParticipationResponseSchema.parse({ status: "reserved", attendanceMode: "physical" }),
      );
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const onSaved = vi.fn();
  void act(() => render(<SessionActionBar slug="workshop" session={value} onSaved={onSaved} />, host));
  return { host, onSaved };
}
const buttons = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].map((item) => item.textContent?.trim() ?? "");
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label);
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
  bodies.splice(0);
  vi.mocked(confirmAction).mockReset();
  vi.mocked(confirmAction).mockResolvedValue(true);
  vi.unstubAllGlobals();
});

describe("session participation action bar", () => {
  it("renders nothing for an open session: its star and admission rule live in the details header", () => {
    const open = session({
      admissionPolicy: "preference",
      availability: { attendanceMode: "physical", state: "available", message: "Open.", bookingAction: null },
    });
    expect(sessionHasParticipationActions(open)).toBe(false);
    expect(sessionHasParticipationActions(open, "Changed.")).toBe(true);
    const { host } = mount(open);
    expect(host.innerHTML).toBe("");
    expect(bodies).toHaveLength(0);
  });

  it.each([
    ["optional_reservation", "available", "reserve", "Reserve a seat"],
    ["reservation", "available", "reserve", "Reserve a seat"],
    ["reservation", "full", "reserve", "Join the waiting list"],
    ["approval", "available", "request", "Request a seat"],
  ] as const)(
    "pairs the %s rule (%s) with one seat action that sends only the command",
    async (admissionPolicy, state, bookingAction, label) => {
      const { host, onSaved } = mount(
        session({
          admissionPolicy,
          availability: { attendanceMode: "physical", state, message: "Seat state.", bookingAction },
        }),
      );
      expect(host.querySelector(".pk-session-admission")).toBeNull();
      expect(buttons(host)).toEqual([label]);
      expect(host.querySelector("select")).toBeNull();
      await act(async () => button(host, label)!.click());
      await settle();
      expect(bodies).toEqual([{ action: bookingAction, expectedPublishedRevision: 3 }]);
      expect(onSaved).toHaveBeenCalledOnce();
    },
  );

  it("shows nothing to someone not invited to an invitation-only session; the header states the rule", () => {
    const { host } = mount(
      session({
        accessPolicy: "invitation",
        availability: {
          attendanceMode: "physical",
          state: "invitation_required",
          message: "Invitation required.",
          bookingAction: null,
        },
      }),
    );
    expect(host.innerHTML).toBe("");
  });

  it("shows an invited person their invitation and its seat action", () => {
    const { host } = mount(session({ accessPolicy: "invitation", invited: true }));
    expect(host.querySelector(".pk-badge")?.textContent).toBe("Invited");
    expect(buttons(host)).toEqual(["Reserve a seat"]);
  });

  it("explains in one line why no seat can be taken", () => {
    const { host } = mount(
      session({
        availability: {
          attendanceMode: null,
          state: "registration_required",
          message: "Register for the event first.",
          bookingAction: null,
        },
      }),
    );
    expect(buttons(host)).toEqual([]);
    expect(host.querySelector("small")?.textContent).toBe("Register for the event to reserve a seat");
  });

  it("gives a person attending the day online no seat, only joining online", () => {
    const { host } = mount(
      session({
        onlineAccessAvailable: true,
        availability: { attendanceMode: "remote", state: "available", message: "Online.", bookingAction: "reserve" },
      }),
    );
    expect(buttons(host)).toEqual(["Join online"]);
    expect(button(host, "Join online")!.classList.contains("pk-btn--primary")).toBe(true);
  });

  it("opens the streaming location's virtual room in the app, keeping a session's own meeting beside it", () => {
    const { host } = mount(
      session({
        liveStreamRoomId: ROOM,
        onlineAccessAvailable: true,
        availability: { attendanceMode: "remote", state: "available", message: "Online.", bookingAction: "reserve" },
      }),
    );
    const join = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent?.trim() === "Join online",
    );
    expect(join?.getAttribute("href")).toBe(`#/events/workshop/virtual?room=${ROOM}&session=${SESSION}`);
    expect(join?.classList.contains("pk-btn--primary")).toBe(true);
    // The external meeting is still offered, as the secondary action, and nothing was fetched to show either.
    expect(buttons(host)).toEqual(["Join the meeting"]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each([
    ["reserved", "Reserved", "Cancel reservation…"],
    ["approval_pending", "Awaiting approval", "Withdraw request…"],
    ["waitlisted", "On the waiting list", "Leave the waiting list…"],
  ] as const)("replaces the seat action with the %s status and a confirmed release", async (status, chip, release) => {
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    const { host } = mount(session({ status, attendanceMode: "physical", saved: true }));
    expect(host.querySelector(".pk-badge")?.textContent).toBe(chip);
    expect(buttons(host)).toEqual([release]);
    const releaseButton = button(host, release)!;
    expect(releaseButton.classList.contains("pk-btn--danger-quiet")).toBe(true);
    await act(async () => releaseButton.click());
    await settle();
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ tone: "danger" }));
    expect(bodies).toHaveLength(0);
    await act(async () => button(host, release)!.click());
    await settle();
    expect(bodies).toEqual([{ action: "cancel" }]);
  });

  it.each([
    [true, "Your seat is released; the session stays on your agenda"],
    [false, "Your seat is released; the session leaves your agenda"],
  ] as const)("says whether a released seat keeps the session on the agenda (starred: %s)", async (starred, line) => {
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    const { host } = mount(session({ status: "reserved", attendanceMode: "physical", saved: starred }));
    await act(async () => button(host, "Cancel reservation…")!.click());
    await settle();
    expect(vi.mocked(confirmAction).mock.calls[0]?.[0].consequences?.[0]).toBe(line);
  });

  it("asks before swapping a confirmed seat in an overlapping session and keeps it when declined", async () => {
    const overlapping = session({
      overlapCount: 1,
      overlaps: [{ id: OTHER, title: "Parallel lab", status: "reserved" }],
    });
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    const { host } = mount(overlapping);
    expect(host.querySelector("details summary")?.textContent).toBe("Overlaps 1 session on your agenda");
    await act(async () => button(host, "Reserve a seat")!.click());
    await settle();
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "This overlaps Parallel lab, where you have a seat. Swap your seat?",
        confirmLabel: "Swap seat",
        cancelLabel: "Keep my current seat",
      }),
    );
    expect(bodies).toHaveLength(0);
    await act(async () => button(host, "Reserve a seat")!.click());
    await settle();
    expect(bodies).toEqual([{ action: "reserve", expectedPublishedRevision: 3, replaceOccurrenceId: OTHER }]);
  });

  it("joins a waiting list without a swap question, since a waiting place holds no seat", async () => {
    const { host } = mount(
      session({
        overlapCount: 1,
        overlaps: [{ id: OTHER, title: "Parallel lab", status: "reserved" }],
        availability: { attendanceMode: "physical", state: "full", message: "Full.", bookingAction: "reserve" },
      }),
    );
    await act(async () => button(host, "Join the waiting list")!.click());
    await settle();
    expect(confirmAction).not.toHaveBeenCalled();
    expect(bodies).toEqual([{ action: "reserve", expectedPublishedRevision: 3 }]);
  });
});

describe("session details layout", () => {
  const day: ContentAgendaDay = {
    date: "2027-01-20",
    locations: [{ id: "blue", label: "Blue hall" }],
    slots: [
      {
        startsAt: "2027-01-20T09:00:00.000Z",
        time: "09:00",
        sessions: [
          {
            id: SESSION,
            title: "Hands-on workshop",
            descriptionHtml: "<p>Session abstract.</p>",
            durationMinutes: 60,
            endsAt: "2027-01-20T10:00:00.000Z",
            locations: ["blue"],
            speakers: [{ name: "Synthetic Speaker" }],
            participation: eventParticipationLink("workshop", SESSION, "reservation"),
          },
        ],
      },
    ],
  };
  function details(staff: boolean, detail?: ComponentChildren) {
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      <AgendaSession
        session={day.slots[0]!.sessions[0]!}
        slot={day.slots[0]}
        locations={day.locations}
        dialogId="details"
        timeZone="UTC"
        personal={{
          starred: true,
          onStar: () => undefined,
          headerActions: staff ? (
            <ButtonLink icon variant="ghost" aria-label="Session check-in" href="#/scanner">
              <IconScan />
            </ButtonLink>
          ) : null,
          detail,
        }}
      />,
    );
    return host.querySelector("dialog#details")!;
  }

  it.each([
    ["scanner staff", true],
    ["an attendee", false],
  ])("shows the session first and participation last for %s", (_who, staff) => {
    const dialog = details(
      staff,
      <SessionDetailsParticipation>
        <p data-participation-bar>Participation</p>
      </SessionDetailsParticipation>,
    );
    const sections = [...dialog.querySelectorAll(".session-modal__body > section")].map(
      (section) => section.querySelector("h3")?.textContent ?? section.getAttribute("aria-label"),
    );
    expect(sections).toEqual(["Abstract", "Speakers", "Participation"]);
    expect(dialog.querySelector(".session-modal__participation [data-participation-bar]")).not.toBeNull();
    expect(dialog.textContent).not.toContain("Start session check-in");
  });

  it.each([
    ["scanner staff", true, ["Star Hands-on workshop", "Session check-in", "Close session details"]],
    ["an attendee", false, ["Star Hands-on workshop", "Close session details"]],
  ])("puts the admission line and same-size star, check-in and close in the header for %s", (_who, staff, tools) => {
    const dialog = details(staff);
    const header = dialog.querySelector(".session-modal__header")!;
    expect(header.querySelector(".session-modal__heading .pk-session-admission")?.textContent).toBe(
      "Registration required · registered attendees only",
    );
    const controls = [...header.querySelectorAll<HTMLElement>(".session-modal__tools > *")];
    expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual(tools);
    for (const control of controls)
      expect([...control.classList].filter((name) => name.startsWith("pk-btn")).sort()).toEqual([
        "pk-btn",
        "pk-btn--ghost",
        "pk-btn--icon",
      ]);
    expect(controls[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(dialog.querySelector(".session-modal__body .pk-session-admission")).toBeNull();
    expect(dialog.querySelector(".session-modal__body [aria-label^='Star']")).toBeNull();
    // Only the header closes the details.
    expect(dialog.querySelectorAll("[data-agenda-close-session]")).toHaveLength(1);
    expect(dialog.querySelector(".session-modal__footer")).toBeNull();
  });

  it("opens on the title rather than the first header action", () => {
    const title = details(true).querySelector("h2.session-modal__title")!;
    expect(title.hasAttribute("autofocus")).toBe(true);
    expect(title.getAttribute("tabindex")).toBe("-1");
    // A speaker profile nested in the details focuses its own name only when it opens.
    const dialog = title.closest("dialog")!;
    expect([...dialog.querySelectorAll("[autofocus]")].filter((item) => item.closest("dialog") === dialog)).toEqual([
      title,
    ]);
  });

  it("keeps the time zone with the time range so only the date wraps before it", () => {
    const when = details(false).querySelector(".session-modal__header .session-modal__when")!;
    const time = when.querySelector(".session-modal__time")!;
    expect(time.textContent).toMatch(/UTC$/);
    expect(when.textContent?.startsWith(time.textContent!)).toBe(false);
  });

  it("adds no participation section when there is nothing to do, as for an open session", () => {
    const dialog = details(false);
    expect(dialog.querySelector(".session-modal__participation")).toBeNull();
    expect(dialog.querySelector(".session-modal__header [aria-label='Star Hands-on workshop']")).not.toBeNull();
  });
});

describe("live participation in the session details", () => {
  const openSession = () =>
    session({
      admissionPolicy: "preference",
      availability: { attendanceMode: "physical", state: "available", message: "Open.", bookingAction: null },
    });
  function mountManager(respond: () => Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(respond));
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    void act(() =>
      render(<SessionParticipationManager slug="workshop" occurrenceId={SESSION} onChanged={vi.fn()} />, host),
    );
    return host;
  }
  const page = (value: ReturnType<typeof session>) =>
    Response.json({ sessions: [value], page: { limit: 1, offset: 0, total: 1, hasMore: false } });

  it("renders no body content while an open session's participation loads", async () => {
    const host = mountManager(() => new Promise<Response>(() => undefined));
    await settle();
    expect(host.innerHTML).toBe("");
  });

  it("stays empty once an open session loads, and shows the section when there is an action", async () => {
    const open = mountManager(async () => page(openSession()));
    await settle();
    await settle();
    expect(open.innerHTML).toBe("");
    const reservable = mountManager(async () => page(session()));
    await settle();
    await settle();
    expect(reservable.querySelector(".session-modal__participation button")?.textContent).toBe("Reserve a seat");
  });

  it("still surfaces a load failure", async () => {
    const host = mountManager(async () => Response.json({ error: "Unavailable" }, { status: 500 }));
    await settle();
    await settle();
    expect(host.querySelector(".session-modal__participation")).not.toBeNull();
  });
});
