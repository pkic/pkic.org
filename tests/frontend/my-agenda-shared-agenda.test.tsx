// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { MyAgenda } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/MyAgenda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionParticipationRequestSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { initializeAgendaFilters } from "../../assets/ts/site/agenda-filters";
import {
  OPEN,
  SESSION,
  WAITLIST,
  card,
  cleanupMyAgendaFixture,
  json,
  listing,
  mount,
  publishedProgram,
  resetMyAgendaFixture,
  setProgram,
  starOf,
  stubFetch,
  stubSessionDialogs,
} from "./helpers/my-agenda-fixture";

// Unit renderer seam only: native links and hashchange still drive the actual window location.
vi.mock("wouter/use-hash-location", async () => {
  const { useSyncExternalStore } = await import("preact/compat");
  const read = () => "/" + window.location.hash.replace(/^#?\/?/, "");
  const subscribe = (changed: () => void) => {
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  };
  return {
    useHashLocation: () => [
      useSyncExternalStore(subscribe, read),
      (to: string) => {
        window.location.hash = to;
      },
    ],
  };
});

vi.mock("../../assets/ts/member-flows/portal/notifications/EventPushNotifications", () => ({
  EventPushNotifications: () => null,
}));

/** The live participation bar's seat action, which only the open session's details render. */
const seatActions = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].filter(
    (item) => item.textContent?.trim() === "Reserve a seat",
  );

beforeEach(resetMyAgendaFixture);
afterEach(cleanupMyAgendaFixture);

describe("personal agenda on the shared agenda component", () => {
  it("keeps the program browsable but offers no personal controls before event registration", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda");
    setProgram(publishedProgram([]));
    stubFetch(async () => {
      throw new Error("Unexpected personal request");
    });
    const host = mount({ canPersonalize: false });
    await vi.waitFor(() => expect(host.querySelector(".pk-content-agenda")).not.toBeNull());
    expect(host.textContent).toContain("Open keynote");
    expect(host.querySelector('button[aria-label^="Star "]')).toBeNull();
    expect(host.querySelector("[data-agenda-mine-filter]")).toBeNull();
    expect(host.querySelector('[aria-label="Calendar and reminders"]')).toBeNull();
    const personal = mount({ canPersonalize: false, mine: true });
    expect(personal.textContent).toContain("Register to create your agenda");
  });
  it("shows personal marks on the published agenda, stars in place and filters to My agenda", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda");
    setProgram(
      publishedProgram([
        { id: SESSION, saved: false, status: "reserved" },
        { id: WAITLIST, saved: true, status: "waitlisted" },
      ]),
    );
    const bodies: ReturnType<typeof sessionParticipationRequestSchema.parse>[] = [];
    const fetcher = stubFetch(async (_input, init) => {
      if (init?.method !== "PUT") throw new Error("Unexpected read");
      const body = sessionParticipationRequestSchema.parse(JSON.parse(String(init.body)));
      bodies.push(body);
      // Changing a star without a booking preserves the saved status.
      return json({ status: "saved", attendanceMode: "physical" });
    });
    const host = mount();
    await vi.waitFor(() => expect(host.querySelector(".pk-content-agenda")).not.toBeNull());
    expect(host.querySelector("table.pk-table, .pk-api-table")).toBeNull();
    expect(card(host, SESSION).hasAttribute("data-agenda-mine")).toBe(true);
    expect(card(host, SESSION).textContent).toContain("Reserved");
    expect(starOf(host, "Original workshop").getAttribute("aria-pressed")).toBe("false");
    expect(card(host, WAITLIST).textContent).toContain("On the waiting list");
    expect(starOf(host, "Popular lab").getAttribute("aria-pressed")).toBe("true");
    expect(card(host, OPEN).hasAttribute("data-agenda-mine")).toBe(false);
    const mine = host.querySelector<HTMLButtonElement>("[data-agenda-mine-filter]")!;
    expect(mine.textContent).toContain("My agenda");
    expect(mine.querySelector("small")?.textContent).toBe("2");
    expect(
      [...host.querySelectorAll("a")]
        .find((link) => link.getAttribute("aria-label") === "Calendar and reminders")
        ?.getAttribute("href"),
    ).toBe("#/events/workshop/agenda?view=calendar");

    await act(async () => starOf(host, "Open keynote").click());
    await vi.waitFor(() => expect(starOf(host, "Open keynote").getAttribute("aria-pressed")).toBe("true"));
    expect(bodies.at(-1)).toEqual({ action: "save" });
    expect(card(host, OPEN).hasAttribute("data-agenda-mine")).toBe(true);
    expect(mine.querySelector("small")?.textContent).toBe("3");

    await act(async () => starOf(host, "Open keynote").click());
    await vi.waitFor(() => expect(starOf(host, "Open keynote").getAttribute("aria-pressed")).toBe("false"));
    expect(bodies.at(-1)).toEqual({ action: "unsave" });
    expect(card(host, OPEN).hasAttribute("data-agenda-mine")).toBe(false);
    expect(card(host, OPEN).textContent).not.toContain("Canceled");
    expect(mine.querySelector("small")?.textContent).toBe("2");
    // Stars act in place: the published agenda is read once, never reloaded.
    expect(fetcher.mock.calls.filter(([, init]) => !init?.method || init.method === "GET")).toHaveLength(1);

    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const root = host.querySelector<HTMLElement>(".pk-content-agenda")!;
    const dispose = initializeAgendaFilters(root);
    await act(async () => mine.click());
    expect(mine.getAttribute("aria-pressed")).toBe("true");
    expect(card(host, OPEN).hidden).toBe(true);
    expect(card(host, SESSION).hidden).toBe(false);
    expect(card(host, WAITLIST).hidden).toBe(false);
    await act(async () => starOf(host, "Open keynote").click());
    await vi.waitFor(() => expect(card(host, OPEN).hidden).toBe(false));
    await act(async () => mine.click());
    expect(mine.getAttribute("aria-pressed")).toBe("false");
    dispose();
  });

  it("shows an empty My agenda as a way to the agenda instead of an empty grid", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda?mine=1");
    setProgram(publishedProgram([]));
    stubFetch(async () => {
      throw new Error("Unexpected read");
    });
    const host = mount({ mine: true });
    await vi.waitFor(() => expect(host.querySelector(".pk-empty-state")).not.toBeNull());
    expect(host.querySelector(".pk-content-agenda")).toBeNull();
    expect(host.querySelector(".pk-empty-state__title")?.textContent).toBe("No saved sessions yet");
    expect(host.querySelector(".pk-empty-state__body")?.textContent).toBe(
      "Star sessions on the agenda to build your own schedule.",
    );
    const browse = [...host.querySelectorAll("a")].find((link) => link.textContent === "Browse the agenda");
    expect(browse?.getAttribute("href")).toBe("#/events/workshop/agenda");
  });

  it("names each card's seat action from the reader's own admission and opens it with the participation bar", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda?mine=1");
    const admission = (state: "available" | "full") => ({
      attendanceMode: "physical",
      state,
      message: state === "full" ? "This session is full." : "A seat is available.",
      bookingAction: "reserve",
    });
    setProgram({
      ...publishedProgram([]),
      availability: [
        { id: SESSION, availability: admission("available") },
        { id: WAITLIST, availability: admission("full") },
        { id: OPEN, availability: admission("available") },
      ],
    });
    const opened = stubSessionDialogs();
    stubFetch(async () => json(listing(1, "reserve")));
    // An empty My agenda first, then the whole program in the same view, as the event app's tabs do.
    const host = mount({ mine: true });
    await vi.waitFor(() => expect(host.querySelector(".pk-empty-state")).not.toBeNull());
    history.replaceState(null, "", "#/events/workshop/agenda");
    await act(() => render(<MyAgenda slug="workshop" canPersonalize />, host));
    await vi.waitFor(() => expect(host.querySelector(".pk-content-agenda")).not.toBeNull());
    const seatOn = (id: string) =>
      card(host, id).querySelector<HTMLButtonElement>(
        "button.pk-content-agenda__media-action[data-agenda-open-session]",
      );
    expect(seatOn(SESSION)?.textContent).toBe("Reserve a seat");
    // A full session's card offers the waiting list, as its details do, never a seat it cannot take.
    expect(seatOn(WAITLIST)?.textContent).toBe("Join the waiting list");
    expect(seatOn(OPEN)).toBeNull();
    // The shared agenda's initializer loads on its own; the card's action opens the details once it has.
    await vi.waitFor(async () => {
      if (!opened.length) await act(async () => seatOn(SESSION)!.click());
      expect(opened).toHaveLength(1);
    });
    const dialog = opened[0]!;
    await vi.waitFor(() =>
      expect(dialog.querySelector('section[aria-label="Participation"]')?.textContent).toContain("Reserve a seat"),
    );
  });

  it("opens a reserved My agenda row with its live seat management", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda?mine=1");
    setProgram(publishedProgram([{ id: SESSION, saved: true, status: "reserved" }]));
    const opened = stubSessionDialogs();
    stubFetch(async () => {
      const response = listing(1, "reserve");
      return json({ ...response, sessions: response.sessions.map((entry) => ({ ...entry, status: "reserved" })) });
    });
    const host = mount({ mine: true });
    await vi.waitFor(() => expect(host.querySelector(".pk-agenda-session-row")).not.toBeNull());
    const link = [...host.querySelectorAll<HTMLAnchorElement>(".pk-agenda-session-row a")].find(
      (entry) => entry.textContent === "Original workshop",
    )!;
    expect(link.closest("li")?.textContent).toContain("Reserved");
    await act(async () => link.click());
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    const dialog = opened[0]!;
    await vi.waitFor(() => {
      const manager = dialog.querySelector('section[aria-label="Participation"]');
      expect(manager?.textContent).toContain("Reserved");
      expect(
        [...manager!.querySelectorAll("button")].some((button) => button.textContent?.includes("Cancel reservation")),
      ).toBe(true);
    });
  });

  it("shows a starred cancellation as a status and omits an unstarred canceled session", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda?mine=1");
    setProgram(
      publishedProgram([
        { id: SESSION, saved: true, status: "canceled" },
        { id: WAITLIST, saved: false, status: "canceled" },
      ]),
    );
    stubFetch(async () => json({ status: "canceled", attendanceMode: "physical" }));
    const host = mount({ mine: true });
    await vi.waitFor(() => expect(host.querySelector(".pk-agenda-session-row")?.textContent).toContain("Canceled"));
    expect(host.querySelectorAll(".pk-agenda-session-row")).toHaveLength(1);
    const star = host.querySelector<HTMLButtonElement>('button[aria-label="Star Original workshop"]')!;
    await act(async () => star.click());
    await vi.waitFor(() => expect(host.textContent).toContain("No saved sessions yet"));
  });

  it("lists only the reader's own sessions compactly, including a private one, and keeps an unstarred row", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda?mine=1");
    const published = publishedProgram([
      { id: WAITLIST, saved: true, status: "waitlisted" },
      { id: SESSION, saved: true, status: null },
    ]);
    setProgram({
      ...published,
      agenda: {
        ...published.agenda,
        occurrences: published.agenda.occurrences.map((occurrence) =>
          occurrence.id === WAITLIST ? { ...occurrence, visibility: "private" } : occurrence,
        ),
      },
    });
    stubFetch(async (_input, init) => {
      if (init?.method !== "PUT") throw new Error("Unexpected read");
      sessionParticipationRequestSchema.parse(JSON.parse(String(init.body)));
      // Changing a star without a booking preserves the saved status.
      return json({ status: "saved", attendanceMode: "physical" });
    });
    const host = mount({ mine: true });
    await vi.waitFor(() => expect(host.querySelector(".pk-agenda-session-rows")).not.toBeNull());
    // A list of the reader's sessions, not the timetable with its empty rooms, slots and view toggles.
    expect(host.querySelector(".pk-content-agenda")).toBeNull();
    expect(host.querySelector("[data-agenda-view], [data-agenda-mine-filter], [data-agenda-tab]")).toBeNull();
    const rowOf = (title: string) =>
      [...host.querySelectorAll<HTMLElement>(".pk-agenda-session-row")].find((row) =>
        row.textContent?.includes(title),
      )!;
    // The server scoped the private session to this reader; the open keynote is not on their agenda.
    expect(host.querySelectorAll(".pk-agenda-session-row")).toHaveLength(2);
    expect(rowOf("Open keynote")).toBeUndefined();
    expect(rowOf("Popular lab").textContent).toContain("On the waiting list");
    // The title opens the session's details from My agenda, so closing them returns here.
    expect(rowOf("Popular lab").querySelector("a")?.getAttribute("href")).toBe(
      `#/events/workshop/agenda?mine=1&session=${WAITLIST}`,
    );
    // The clock is named once for the whole list.
    expect(host.querySelectorAll(".pk-agenda-session-rows__clock")).toHaveLength(1);
    const star = () =>
      rowOf("Original workshop").querySelector<HTMLButtonElement>('button[aria-label="Star Original workshop"]')!;
    expect(star().getAttribute("aria-pressed")).toBe("true");
    await act(async () => star().click());
    await vi.waitFor(() => expect(star().getAttribute("aria-pressed")).toBe("false"));
    // Un-starring keeps the row where it was, so the reader can star it again.
    expect(host.querySelectorAll(".pk-agenda-session-row")).toHaveLength(2);
  });

  it("opens a deep-linked session's details with live management and clears only its focus on close", async () => {
    history.replaceState(
      null,
      "",
      `/portal/?utm_source=conference#/events/workshop/agenda?session=${SESSION}&agendaMine=1`,
    );
    setProgram(publishedProgram([]));
    // The shared agenda initializer loads with the deep link, as on a real portal page.
    const opened = stubSessionDialogs();
    const paths: URL[] = [];
    stubFetch(async (input) => {
      paths.push(new URL(String(input), location.origin));
      return json(listing(1, "reserve"));
    });
    const host = mount();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    const dialog = opened[0]!;
    expect(dialog.closest("[data-agenda-occurrence]")?.getAttribute("data-agenda-occurrence")).toBe(SESSION);
    await vi.waitFor(() => expect(seatActions(dialog)).toHaveLength(1));
    expect(
      paths.some((url) => url.searchParams.get("occurrenceId") === SESSION && url.searchParams.get("limit") === "1"),
    ).toBe(true);
    expect(dialog.querySelector('button[aria-label="Star Original workshop"]')).not.toBeNull();
    // One star and one seat action; nothing asks for an attendance mode or a room.
    expect(dialog.querySelectorAll('button[aria-label="Star Original workshop"]')).toHaveLength(1);
    expect(dialog.querySelector("select")).toBeNull();
    expect(seatActions(host)).toHaveLength(1);
    await act(async () => dialog.removeAttribute("open"));
    await vi.waitFor(() => expect(location.hash).toBe("#/events/workshop/agenda/2027-01-20?agendaMine=1"));
    expect(location.search).toBe("?utm_source=conference");
    await vi.waitFor(() => expect(seatActions(host)).toHaveLength(0));
  });

  it("rereads the program and reopens the session when its approved publication changed", async () => {
    setProgram(publishedProgram([]));
    const published = publishedProgram([]);
    // The approved session moved to a later slot, which remounts its card and dialog.
    const revised = {
      ...published,
      agenda: {
        ...published.agenda,
        revision: 2,
        publishedRevision: 2,
        occurrences: published.agenda.occurrences.map((occurrence) =>
          occurrence.id === SESSION
            ? {
                ...occurrence,
                title: "Revised workshop",
                startAt: "2027-01-20T15:00:00.000Z",
                endAt: "2027-01-20T16:00:00.000Z",
              }
            : occurrence,
        ),
      },
    };
    const opened = stubSessionDialogs();
    const fetcher = stubFetch(async () => {
      // The live participation row is already on the newer approved publication.
      setProgram(revised);
      return json(listing(2, "reserve"));
    });
    const host = mount();
    const programReads = () =>
      fetcher.mock.calls.filter(([input]) =>
        new URL(String(input), location.origin).pathname.endsWith("/agenda/participation/program"),
      ).length;
    await vi.waitFor(() => expect(programReads()).toBe(2));
    await vi.waitFor(() => {
      const dialog = opened.at(-1)!;
      expect(dialog.isConnected).toBe(true);
      expect(dialog.querySelector("h2")?.textContent).toBe("Revised workshop");
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("confirm your choice again");
    });
    expect(host.textContent).not.toContain("Original workshop");
    expect(location.hash).toBe(`#/events/workshop/agenda/2027-01-20?session=${SESSION}`);
    expect(programReads()).toBe(2);
    await act(async () => opened.at(-1)!.removeAttribute("open"));
  });

  it("replaces the open session's details when the deep link moves to another session", async () => {
    setProgram(publishedProgram([]));
    const opened = stubSessionDialogs();
    stubFetch(async (input) => {
      const occurrence = new URL(String(input), location.origin).searchParams.get("occurrenceId");
      const response = listing(1, "reserve");
      if (occurrence === WAITLIST) Object.assign(response.sessions[0]!, { id: WAITLIST, title: "Popular lab" });
      return json(response);
    });
    const host = mount();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    await act(async () => {
      history.pushState(null, "", `#/events/workshop/agenda?session=${WAITLIST}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await vi.waitFor(() => expect(opened).toHaveLength(2));
    const open = [...host.querySelectorAll<HTMLDialogElement>("dialog[open]")];
    expect(open).toEqual([opened[1]]);
    expect(open[0]!.closest("[data-agenda-occurrence]")?.getAttribute("data-agenda-occurrence")).toBe(WAITLIST);
    // Live management follows the session now on screen.
    await vi.waitFor(() => expect(seatActions(open[0]!)).toHaveLength(1));
    expect(seatActions(host)).toHaveLength(1);
    // The agenda settles the incoming route on the canonical day path after its restore frame.
    await vi.waitFor(() => expect(location.hash).toBe(`#/events/workshop/agenda/2027-01-20?session=${WAITLIST}`));
    await act(async () => open[0]!.removeAttribute("open"));
  });

  it("keeps a dedicated view for a linked session outside the shared agenda", async () => {
    setProgram(publishedProgram([]));
    history.replaceState(null, "", "#/events/workshop/agenda?session=10000000-0000-4000-8000-000000000009");
    stubFetch(async () => json(listing(1, "request", true)));
    const host = mount();
    await vi.waitFor(() => expect(host.textContent).toContain("no longer available in the published agenda"));
    expect(host.querySelector(".pk-content-agenda")).toBeNull();
  });

  it("explains an unpublished agenda and keeps calendar preferences reachable", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda");
    stubFetch(async (input) =>
      json(
        new URL(String(input), location.origin).pathname.endsWith("/calendar/settings")
          ? { includeTentative: false, reminderEnabled: false, reminderMinutes: 10 }
          : new URL(String(input), location.origin).pathname.endsWith("/calendar/subscriptions/current")
            ? { active: false, subscription: null }
            : listing(1, "request"),
      ),
    );
    const host = mount();
    await vi.waitFor(() => expect(host.textContent).toContain("The agenda has not been published yet."));
    await act(async () => {
      [...host.querySelectorAll<HTMLAnchorElement>("a")]
        .find((link) => link.textContent === "Calendar and reminders")!
        .click();
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Add My agenda to your calendar"));
    expect(location.hash).toBe("#/events/workshop/agenda?view=calendar");
    expect(host.textContent).toContain("Email me before my sessions");
  });
});
