// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  personalAgendaResponseSchema,
  personalAgendaSessionSchema,
} from "../../assets/shared/schemas/event-personal-agenda";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { formatAgendaInstant } from "../../assets/shared/agenda-time-display";
import { MyAgenda } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/MyAgenda";

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

const SESSION = "10000000-0000-4000-8000-000000000001";
const OLD_ROOM = "10000000-0000-4000-8000-000000000002";
const NEW_ROOM = "10000000-0000-4000-8000-000000000003";
const hosts: HTMLElement[] = [];
function session(revision: number, bookingAction: "reserve" | "request") {
  const roomId = revision === 1 ? OLD_ROOM : NEW_ROOM;
  return personalAgendaSessionSchema.parse({
    id: SESSION,
    publishedRevision: revision,
    title: revision === 1 ? "Original workshop" : "Revised workshop",
    roomId: null,
    rooms: [{ id: roomId, name: revision === 1 ? "Original room" : "Revised room" }],
    timeZone: "UTC",
    startAt: revision === 1 ? "2027-01-20T09:00:00.000Z" : "2027-01-20T11:00:00.000Z",
    endAt: revision === 1 ? "2027-01-20T10:00:00.000Z" : "2027-01-20T12:00:00.000Z",
    admissionPolicy: bookingAction === "reserve" ? "reservation" : "approval",
    status: null,
    attendanceMode: "physical",
    availability: [
      {
        attendanceMode: "physical",
        roomId,
        state: "available",
        message: "A place is available.",
        bookingAction,
        canSave: true,
      },
    ],
  });
}
function listing(revision: number, action: "reserve" | "request", empty = false) {
  return personalAgendaResponseSchema.parse({
    sessions: empty ? [] : [session(revision, action)],
    page: { limit: 50, offset: 0, total: empty ? 0 : 1, hasMore: false },
  });
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function refusal() {
  return json(
    {
      error: {
        code: "SESSION_PUBLICATION_CHANGED",
        message:
          "The published agenda changed. Refresh it and confirm your choice again. Any existing reservation has been preserved.",
      },
    },
    409,
  );
}
function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<MyAgenda slug="workshop" />, host));
  return host;
}
async function choose(host: HTMLElement, value: string) {
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('select[name="action"]')!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function update(host: HTMLElement) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === "Update",
  );
  expect(button).toBeDefined();
  return button!;
}
async function clickUpdate(host: HTMLElement) {
  await act(async () => {
    update(host).click();
  });
}
beforeEach(() => {
  history.replaceState(null, "", `#/events/workshop/agenda?session=${SESSION}`);
});
afterEach(() => {
  for (const host of hosts.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("personal agenda publication revisions", () => {
  it.each(["reserve", "request"] as const)(
    "refreshes a stale %s without retrying and requires an explicit submission of the new revision",
    async (action) => {
      const bodies: ReturnType<typeof sessionParticipationRequestSchema.parse>[] = [];
      let gets = 0;
      let accepted = false;
      let resolveRefresh!: (value: Response) => void;
      const refreshed = new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), location.origin);
          if (init?.method === "PUT") {
            const body = sessionParticipationRequestSchema.parse(JSON.parse(String(init.body)));
            bodies.push(body);
            if (body.expectedPublishedRevision !== 2) return refusal();
            accepted = true;
            return json(
              sessionParticipationResponseSchema.parse({
                status: action === "reserve" ? "reserved" : "approval_pending",
                attendanceMode: "physical",
              }),
            );
          }
          if (url.searchParams.get("status") === "reserved") return json(listing(1, action, true));
          gets++;
          if (gets === 1) return json(listing(1, action));
          if (gets === 2) return refreshed;
          const response = listing(2, action);
          Object.assign(response.sessions[0]!, {
            status: accepted ? (action === "reserve" ? "reserved" : "approval_pending") : null,
            roomId: NEW_ROOM,
          });
          return json(response);
        }),
      );
      const host = mount();
      await vi.waitFor(() => expect(host.textContent).toContain("Original workshop"));
      await choose(host, action);
      await clickUpdate(host);
      await vi.waitFor(() => {
        expect(gets).toBe(2);
        expect(update(host).disabled).toBe(true);
      });
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("The published agenda changed.");
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "Any existing reservation has been preserved.",
      );
      expect(host.textContent).toContain("Original workshop");
      expect(host.textContent).toContain("Original room");
      expect(accepted).toBe(false);
      await clickUpdate(host);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]?.expectedPublishedRevision).toBe(1);
      expect(bodies[0]?.roomId).toBe(OLD_ROOM);
      await act(async () => {
        resolveRefresh(json(listing(2, action)));
      });
      await vi.waitFor(() => {
        expect(host.textContent).toContain("Revised workshop");
        expect(update(host).disabled).toBe(false);
      });
      expect(bodies).toHaveLength(1);
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("confirm your choice again");
      await clickUpdate(host);
      await vi.waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1]?.expectedPublishedRevision).toBe(2);
      expect(bodies[1]?.roomId).toBe(NEW_ROOM);
      expect(bodies[1]?.action).toBe(action);
      await vi.waitFor(() => {
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(host.textContent).toContain(action === "reserve" ? "Reserved" : "Awaiting approval");
      });
      expect(accepted).toBe(true);
      expect(bodies).toHaveLength(2);
      expect(host.textContent).toContain("Revised room");
      expect(host.querySelector('button[aria-label="Save preference"]')?.getAttribute("aria-pressed")).toBe("false");
    },
  );

  it("keeps a stale reservation blocked when canonical refresh fails", async () => {
    let gets = 0;
    let puts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          sessionParticipationRequestSchema.parse(JSON.parse(String(init.body)));
          puts++;
          return refusal();
        }
        gets++;
        return gets === 1
          ? json(listing(1, "request"))
          : json({ error: { code: "UNAVAILABLE", message: "Please try refreshing later." } }, 503);
      }),
    );
    const host = mount();
    await vi.waitFor(() => expect(host.textContent).toContain("Original workshop"));
    await choose(host, "request");
    await clickUpdate(host);
    await vi.waitFor(() => expect(host.textContent).toContain("Please try refreshing later."));
    expect(update(host).disabled).toBe(true);
    await clickUpdate(host);
    expect(puts).toBe(1);
  });

  it.each(["save", "unsave", "cancel"] as const)(
    "leaves %s independent of reservation revision preconditions",
    async (action) => {
      const bodies: ReturnType<typeof sessionParticipationRequestSchema.parse>[] = [];
      let saved = action === "unsave";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === "PUT") {
            bodies.push(sessionParticipationRequestSchema.parse(JSON.parse(String(init.body))));
            saved = action === "save";
            return json(
              sessionParticipationResponseSchema.parse({
                status: action === "cancel" ? "canceled" : "reserved",
                attendanceMode: "physical",
              }),
            );
          }
          const response = listing(1, "request");
          Object.assign(response.sessions[0]!, { status: "reserved", saved, roomId: OLD_ROOM });
          return json(response);
        }),
      );
      const host = mount();
      await vi.waitFor(() => expect(host.textContent).toContain("Original workshop"));
      if (action === "cancel") {
        await choose(host, action);
        await clickUpdate(host);
      } else {
        const label = action === "save" ? "Save preference" : "Remove preference";
        const star = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
        expect(star.getAttribute("type")).toBe("button");
        expect(star.getAttribute("aria-pressed")).toBe(String(action === "unsave"));
        expect(star.textContent).toBe("");
        expect(star.querySelector("path")?.getAttribute("fill")).toBe(action === "unsave" ? "currentColor" : "none");
        await act(() => {
          star.click();
          star.click();
        });
      }
      await vi.waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]?.action).toBe(action);
      expect(bodies[0]).not.toHaveProperty("expectedPublishedRevision");
      if (action !== "cancel") {
        expect(bodies[0]?.attendanceMode).toBe("physical");
        expect(bodies[0]?.roomId).toBe(OLD_ROOM);
        await vi.waitFor(() =>
          expect(
            host
              .querySelector(`button[aria-label="${action === "save" ? "Remove preference" : "Save preference"}"]`)
              ?.getAttribute("aria-pressed"),
          ).toBe(String(action === "save")),
        );
        expect(host.textContent).toContain("Reserved");
        expect(host.textContent).toContain("Original room");
        expect(host.querySelector<HTMLSelectElement>('select[name="attendanceMode"]')?.value).toBe("physical");
        expect(host.querySelector('option[value="save"],option[value="unsave"]')).toBeNull();
      }
    },
  );
});

describe("dedicated participant agenda destinations", () => {
  it("keeps forms out of the list and opens the selected session from its record menu", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda");
    const paths: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        paths.push(new URL(String(input), location.origin));
        return json(listing(1, "request"));
      }),
    );
    const host = mount();
    await vi.waitFor(() =>
      expect(host.querySelector('button[aria-label="Actions for Original workshop"]')).not.toBeNull(),
    );
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).not.toContain("Save preferences");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Actions for Original workshop"]')!.click();
    });
    const manage = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent === "Manage participation",
    );
    expect(manage?.hash).toBe(`#/events/workshop/agenda?session=${SESSION}`);
    await act(async () => {
      manage!.click();
    });
    await vi.waitFor(() => expect(host.querySelector('select[name="action"]')).not.toBeNull());
    expect(host.querySelector("table")).toBeNull();
    expect(
      paths.some((url) => url.searchParams.get("occurrenceId") === SESSION && url.searchParams.get("limit") === "1"),
    ).toBe(true);
    await act(async () => {
      [...host.querySelectorAll<HTMLAnchorElement>("a")]
        .find((link) => link.textContent === "Back to My agenda")!
        .click();
    });
    await vi.waitFor(() => expect(host.querySelector("table")).not.toBeNull());
    expect(host.querySelector("form")).toBeNull();
  });

  it("opens calendar editing only in its dedicated preferences destination", async () => {
    history.replaceState(null, "", "#/events/workshop/agenda");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        return json(
          url.pathname.endsWith("/calendar/settings")
            ? { includeTentative: false, reminderEnabled: false, reminderMinutes: 10 }
            : listing(1, "request"),
        );
      }),
    );
    const host = mount();
    await vi.waitFor(() => expect(host.querySelector("table")).not.toBeNull());
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="My agenda actions"]')!.click();
    });
    await act(async () => {
      [...host.querySelectorAll<HTMLAnchorElement>("a")]
        .find((link) => link.textContent === "Calendar preferences")!
        .click();
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Save preferences"));
    expect(location.hash).toBe("#/events/workshop/agenda?view=calendar");
    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelectorAll("form")).toHaveLength(1);
    expect(host.querySelector('select[name="action"]')).toBeNull();
  });
});

describe("participation clock parity", () => {
  it.each([
    ["remote", false],
    ["physical", false],
    ["physical", true],
  ] as const)(
    "keeps %s attendance clock parity with optional local time=%s in list and dedicated RSVP",
    async (mode, showLocal) => {
      const original = Intl.DateTimeFormat.prototype.resolvedOptions;
      vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
        this: Intl.DateTimeFormat,
      ) {
        return { ...original.call(this), timeZone: "Asia/Tokyo" };
      });
      const row = personalAgendaSessionSchema.parse({
        ...session(1, "request"),
        timeZone: "Europe/Amsterdam",
        startAt: "2026-12-01T23:30:00.000Z",
        endAt: "2026-12-02T00:30:00.000Z",
        attendanceMode: mode,
        availability: [
          {
            ...session(1, "request").availability[0],
            attendanceMode: mode,
            roomId: mode === "remote" ? null : OLD_ROOM,
          },
        ],
      });
      const response = personalAgendaResponseSchema.parse({
        sessions: [row],
        page: { limit: 50, offset: 0, total: 1, hasMore: false },
      });
      const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(response));
      vi.stubGlobal("fetch", fetcher);
      history.replaceState(null, "", "#/events/workshop/agenda");
      const host = mount();
      const selectedSessionLink = () =>
        [...host.querySelectorAll<HTMLAnchorElement>("tbody a")].find((link) => link.textContent === row.title);
      await vi.waitFor(() => expect(selectedSessionLink()).toBeDefined());
      if (showLocal) {
        await act(async () => {
          const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      const selectedRow = selectedSessionLink()!.closest("tr")!;
      const whenCell = [...selectedRow.querySelectorAll("td")].find(
        (cell) => cell.querySelector(".pk-table__mobile-label")?.textContent === "When",
      )!;
      const when = whenCell.querySelector(".pk-table__value")!;
      const primary = mode === "remote" ? "Asia/Tokyo" : "Europe/Amsterdam";
      expect(when.querySelector("span")?.textContent).toContain(formatAgendaInstant(row.startAt, primary));
      if (mode === "remote" || showLocal)
        expect(when.querySelector("small")?.textContent).toContain(
          mode === "remote" ? "Europe/Amsterdam" : "Asia/Tokyo",
        );
      else expect(when.querySelector("small")).toBeNull();
      await act(async () => {
        selectedSessionLink()!.click();
      });
      await vi.waitFor(() => expect(host.querySelector('select[name="action"]')).not.toBeNull());
      const starts = [...host.querySelectorAll("dt")].find(
        (term) => term.textContent === "Starts",
      )!.nextElementSibling!;
      expect(starts.querySelector("span span")?.textContent).toContain(formatAgendaInstant(row.startAt, primary));
      if (mode === "remote" || showLocal)
        expect(starts.querySelector("small")?.textContent).toContain(
          mode === "remote" ? "Europe/Amsterdam" : "Asia/Tokyo",
        );
      else expect(starts.querySelector("small")).toBeNull();
      expect(fetcher.mock.calls.every(([, init]) => !init || !init.method || init.method === "GET")).toBe(true);
    },
  );
});
