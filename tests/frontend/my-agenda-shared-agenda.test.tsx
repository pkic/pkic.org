// @vitest-environment jsdom
import { act } from "preact/test-utils";
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

beforeEach(resetMyAgendaFixture);
afterEach(cleanupMyAgendaFixture);

describe("personal agenda on the shared agenda component", () => {
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
      // Unstarring a session without a booking is stored as "canceled" by the server.
      return json({ status: body.action === "save" ? "saved" : "canceled", attendanceMode: "physical" });
    });
    const host = mount();
    await vi.waitFor(() => expect(host.querySelector(".pk-content-agenda")).not.toBeNull());
    expect(host.querySelector("table.pk-table, .pk-api-table")).toBeNull();
    expect(card(host, SESSION).hasAttribute("data-agenda-mine")).toBe(true);
    expect(card(host, SESSION).textContent).toContain("Reserved");
    expect(starOf(host, "Original workshop").getAttribute("aria-pressed")).toBe("false");
    expect(card(host, WAITLIST).textContent).toContain("Waitlisted");
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
    expect(bodies.at(-1)).toEqual({ action: "save", attendanceMode: "physical" });
    expect(card(host, OPEN).hasAttribute("data-agenda-mine")).toBe(true);
    expect(mine.querySelector("small")?.textContent).toBe("3");

    await act(async () => starOf(host, "Open keynote").click());
    await vi.waitFor(() => expect(starOf(host, "Open keynote").getAttribute("aria-pressed")).toBe("false"));
    expect(bodies.at(-1)).toEqual({ action: "unsave", attendanceMode: "physical" });
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

  it("opens My agenda with its filter on and lists the reader's own private session without a public page", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda?mine=1");
    const published = publishedProgram([{ id: WAITLIST, saved: true, status: "waitlisted" }]);
    const longer = "A description long enough for a published session page of its own.";
    setProgram({
      ...published,
      agenda: {
        ...published.agenda,
        occurrences: published.agenda.occurrences.map((occurrence) =>
          occurrence.id === WAITLIST
            ? { ...occurrence, description: longer, visibility: "private" }
            : occurrence.id === OPEN
              ? { ...occurrence, description: longer }
              : occurrence,
        ),
      },
    });
    stubFetch(async () => {
      throw new Error("Unexpected read");
    });
    const host = mount({ mine: true });
    await vi.waitFor(() => expect(host.querySelector(".pk-content-agenda")).not.toBeNull());
    const mine = host.querySelector<HTMLButtonElement>("[data-agenda-mine-filter]")!;
    expect(mine.getAttribute("aria-pressed")).toBe("true");
    // The server scoped the private session to this reader; it is on their agenda with its own controls.
    expect(card(host, WAITLIST).hasAttribute("data-agenda-mine")).toBe(true);
    expect(starOf(host, "Popular lab").getAttribute("aria-pressed")).toBe("true");
    expect(card(host, WAITLIST).querySelector(`a[href="/events/workshop/sessions/${WAITLIST}/"]`)).toBeNull();
    expect(card(host, OPEN).querySelector(`a[href="/events/workshop/sessions/${OPEN}/"]`)).not.toBeNull();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const dispose = initializeAgendaFilters(host.querySelector<HTMLElement>(".pk-content-agenda")!);
    expect(card(host, OPEN).hidden).toBe(true);
    expect(card(host, WAITLIST).hidden).toBe(false);
    dispose();
  });

  it("opens a deep-linked session's details with live management and clears the link on close", async () => {
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
    await vi.waitFor(() => expect(dialog.querySelector('select[name="action"]')).not.toBeNull());
    expect(
      paths.some((url) => url.searchParams.get("occurrenceId") === SESSION && url.searchParams.get("limit") === "1"),
    ).toBe(true);
    expect(dialog.querySelector('button[aria-label="Star Original workshop"]')).not.toBeNull();
    // The dialog's shared star is the only preference control.
    expect(dialog.querySelector('button[aria-label="Save preference"]')).toBeNull();
    expect(host.querySelectorAll('select[name="action"]')).toHaveLength(1);
    await act(async () => dialog.removeAttribute("open"));
    await vi.waitFor(() => expect(location.hash).toBe("#/events/workshop/agenda"));
    await vi.waitFor(() => expect(host.querySelector('select[name="action"]')).toBeNull());
  });

  it("rereads the programme and reopens the session when its approved publication changed", async () => {
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
    expect(location.hash).toBe(`#/events/workshop/agenda?session=${SESSION}`);
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
    await vi.waitFor(() => expect(open[0]!.querySelector('select[name="action"]')).not.toBeNull());
    expect(host.querySelectorAll('select[name="action"]')).toHaveLength(1);
    expect(location.hash).toBe(`#/events/workshop/agenda?session=${WAITLIST}`);
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
