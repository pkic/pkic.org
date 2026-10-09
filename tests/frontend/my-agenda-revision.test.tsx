// @vitest-environment jsdom
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
import { confirmAction } from "../../assets/ts/components/ConfirmDialog";
import {
  NEW_ROOM,
  OLD_ROOM,
  cleanupMyAgendaFixture,
  json,
  listing,
  mount,
  resetMyAgendaFixture,
  session,
  stubFetch,
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

vi.mock("../../assets/ts/components/ConfirmDialog", async (original) => ({
  ...(await original<typeof import("../../assets/ts/components/ConfirmDialog")>()),
  confirmAction: vi.fn(async () => true),
}));

vi.mock("../../assets/ts/member-flows/portal/notifications/EventPushNotifications", () => ({
  EventPushNotifications: () => null,
}));

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
beforeEach(resetMyAgendaFixture);
afterEach(cleanupMyAgendaFixture);

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
      stubFetch(
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
    stubFetch(
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
      stubFetch(
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
        // Canceling is never a choice in the participation select; it is its own confirmed action.
        const select = host.querySelector<HTMLSelectElement>('select[name="action"]')!;
        expect([...select.options].map((option) => option.value)).not.toContain("cancel");
        const cancel = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
          (item) => item.textContent?.trim() === "Cancel my session registration…",
        )!;
        vi.mocked(confirmAction).mockClear();
        await act(async () => cancel.click());
        expect(confirmAction).toHaveBeenCalledOnce();
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

describe("participation clock parity", () => {
  it.each(["remote", "physical"] as const)(
    "keeps %s attendance clock parity in the dedicated session view",
    async (mode) => {
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
      const fetcher = stubFetch(async () => json(response));
      const host = mount();
      await vi.waitFor(() => expect(host.querySelector('select[name="action"]')).not.toBeNull());
      const starts = [...host.querySelectorAll("dt")].find(
        (term) => term.textContent === "Starts",
      )!.nextElementSibling!;
      const primary = mode === "remote" ? "Asia/Tokyo" : "Europe/Amsterdam";
      expect(starts.querySelector("span span")?.textContent).toContain(formatAgendaInstant(row.startAt, primary));
      if (mode === "remote") expect(starts.querySelector("small")?.textContent).toContain("Europe/Amsterdam");
      else expect(starts.querySelector("small")).toBeNull();
      expect(fetcher.mock.calls.every(([, init]) => !init || !init.method || init.method === "GET")).toBe(true);
    },
  );
});
