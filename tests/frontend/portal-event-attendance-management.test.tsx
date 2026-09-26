// @vitest-environment jsdom
/**
 * The group event's attendee roster and one registration's own page.
 *
 * The roster used to unfold the attendance manager between its rows — a
 * faceted record drawn as an expansion, with no address anyone could share —
 * and said "in_person" for a registration whose days were one confirmed and
 * two waitlisted. What is asserted here is what a screenshot cannot: that a
 * row is a real link to the registration's URL, that each day's state is said
 * in words, that the waitlist filter reaches the query, and that the record
 * page sends the same canonical group requests the expansion did.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventAttendanceRegistrationsListResponseSchema } from "../../assets/shared/schemas/event-registrations";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupEventRegistrationRecord } from "../../assets/ts/member-flows/portal/sections/management/GroupEventRegistrationRecord";
import { GroupEventRegistrations } from "../../assets/ts/member-flows/portal/sections/management/GroupEventRegistrations";
import { chooseColumnFilter, columnFilterOptions } from "./helpers/column-menu";
import { menuItemNamed } from "./helpers/row-actions";
import { controlFor } from "./helpers/labelled-control";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const REGISTRATION_ID = "30000000-0000-4000-8000-000000000001";
const REGISTRATION_ENDPOINT = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/registrations/${REGISTRATION_ID}`;
const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

function mountRoster(): HTMLElement {
  return mount(<GroupEventRegistrations groupId={GROUP_ID} eventId={EVENT_ID} />);
}

function mountRecord(canVip = false): HTMLElement {
  return mount(
    <>
      <ConfirmDialogHost />
      <GroupEventRegistrationRecord
        groupId={GROUP_ID}
        eventId={EVENT_ID}
        registrationId={REGISTRATION_ID}
        canVip={canVip}
      />
    </>,
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function registrationList() {
  return {
    event: { id: EVENT_ID, slug: "architecture-workshop", name: "Architecture workshop" },
    registrations: [
      {
        id: REGISTRATION_ID,
        user_id: "40000000-0000-4000-8000-000000000001",
        user_email: "member@example.test",
        display_name: "Group Member",
        headshot_url: null,
        organization_name: null,
        job_title: null,
        status: "registered",
        attendance_type: "in_person",
        days: [
          { dayDate: "2026-09-01", label: "Day one", attendanceType: "in_person", waitlistStatus: null },
          { dayDate: "2026-09-02", label: "Day two", attendanceType: "in_person", waitlistStatus: "waiting" },
          { dayDate: "2026-09-03", label: "Day three", attendanceType: "virtual", waitlistStatus: null },
        ],
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    stats: {
      byAttendanceType: { in_person: 1 },
      attendanceStatusByType: { in_person: { accepted: 1, waitlisted: 1 } },
      byStatus: { registered: 1 },
    },
    page: { limit: 50, offset: 0, total: 1, hasMore: false },
  };
}

function attendanceDetail(waitlisted: boolean) {
  return {
    registration: {
      id: REGISTRATION_ID,
      event_id: EVENT_ID,
      user_id: "40000000-0000-4000-8000-000000000001",
      user_email: "member@example.test",
      display_name: "Group Member",
      status: "registered",
      attendance_type: "in_person",
      source_type: "direct",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    dayAttendance: [{ dayDate: "2026-09-01", attendanceType: "in_person", label: "Day one" }],
    dayWaitlist: waitlisted
      ? [{ dayDate: "2026-09-01", status: "waiting", priorityLane: "general", offerExpiresAt: null }]
      : [],
    eventDays: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        date: "2026-09-01",
        label: "Day one",
        startsAt: null,
        endsAt: null,
        sortOrder: 0,
        attendanceOptions: [
          { value: "in_person", label: "In-person", capacity: 10 },
          { value: "livestream", label: "Live stream", capacity: null },
        ],
        attendanceCounts: { in_person: 10 },
      },
    ],
  };
}

function installApi(waitlisted: boolean) {
  const requests: Array<{ path: string; method: string; body?: unknown; search?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ path: url.pathname, method, body, search: url.search });
      if (method === "GET" && url.pathname.endsWith(`/events/${EVENT_ID}/registrations`)) {
        return json(registrationList());
      }
      if (method === "GET" && url.pathname === REGISTRATION_ENDPOINT) return json(attendanceDetail(waitlisted));
      if (method === "PATCH" && url.pathname === `${REGISTRATION_ENDPOINT}/day-attendance`) {
        return json({ success: true });
      }
      if (method === "PATCH" && url.pathname === REGISTRATION_ENDPOINT) {
        const detail = attendanceDetail(waitlisted);
        return json({ success: true, ...detail, registration: { ...detail.registration, status: "cancelled" } });
      }
      if (method === "POST" && url.pathname === `${REGISTRATION_ENDPOINT}/admissions`) {
        return json({
          success: true,
          registration: attendanceDetail(false).registration,
          admittedDayDates: ["2026-09-01"],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
});

/**
 * The design system's choice control whose line reads `text`. Its label wraps
 * the control, so there is no `for` to resolve: the input inside is the one.
 */
/** Opens the first day's own actions menu on the record. */
async function openDayMenu(container: HTMLElement): Promise<void> {
  const trigger = container.querySelector<HTMLButtonElement>(
    '[aria-label="Attendance by day"] button[aria-label^="Actions for"]',
  );
  if (!trigger) throw new Error("no day offers an actions menu");
  await act(async () => trigger.click());
}

/** Each stat card in a totals row, by its label: the figure and its note. */
function statFigures(root: Element | null): Record<string, { value: string; note?: string }> {
  const figures: Record<string, { value: string; note?: string }> = {};
  for (const card of root?.querySelectorAll(".pk-stat-card") ?? []) {
    const label = card.querySelector(".pk-stat-card__label")?.textContent?.trim() ?? "";
    const note = card.querySelector(".pk-stat-card__note")?.textContent?.trim();
    figures[label] = {
      value: card.querySelector(".pk-stat-card__value")?.textContent?.trim() ?? "",
      ...(note ? { note } : {}),
    };
  }
  return figures;
}

describe("group event registrations roster", () => {
  it("names the roster and every one of its columns, with no blank action column", async () => {
    installApi(false);
    const container = mountRoster();
    await settle();

    expect(container.querySelector("caption")?.textContent).toBe("Registrations");
    const headers = [...container.querySelectorAll("thead th")].map((cell) =>
      (cell.textContent ?? "").replace(/[↑↓↕]/g, "").trim(),
    );
    // Organization joins the row and the job title waits in the columns
    // menu, hidden by default (#119).
    expect(headers).toEqual(["Attendee", "Organization", "Status", "Attendance", "Registered"]);
    for (const header of headers) expect(header).not.toBe("");
  });

  it("makes each row a link to the registration's own page, never an expansion between the rows", async () => {
    installApi(false);
    const container = mountRoster();
    await settle();

    const link = container.querySelector<HTMLAnchorElement>("tbody a.pk-table__row-link");
    expect(link?.textContent).toBe("Open registration for Group Member");
    expect(link?.getAttribute("href")).toBe(`#/groups/${GROUP_ID}/events/${EVENT_ID}/registrations/${REGISTRATION_ID}`);
    expect(container.querySelector("button.pk-table__row-link")).toBeNull();
    expect(container.querySelector(".pk-table__detail")).toBeNull();
  });

  it("states each day's attendance and waitlist standing in words, not the derived whole-registration type", async () => {
    installApi(false);
    const container = mountRoster();
    await settle();

    const days = container.querySelector('[aria-label="Attendance by day"]');
    expect(days).not.toBeNull();
    const badges = [...days!.querySelectorAll(".pk-badge")].map((badge) => badge.textContent);
    expect(badges).toHaveLength(3);
    expect(badges[0]).toContain("In-person");
    expect(badges[1]).toContain("Waitlisted");
    expect(badges[2]).toContain("Virtual");
    // The raw token never reaches the page.
    expect(container.textContent).not.toContain("in_person");
  });

  it("offers the waitlist as the Attendance column's filter and sends it to the query", async () => {
    const requests = installApi(false);
    const container = mountRoster();
    await settle();

    expect(columnFilterOptions(container, "Attendance")).toEqual([
      "All attendance",
      "On a day waitlist",
      "Not waitlisted",
    ]);
    await chooseColumnFilter(container, "Attendance", "On a day waitlist");
    await settle();
    const last = requests.filter(({ method }) => method === "GET").at(-1);
    expect(new URLSearchParams(last?.search).get("waitlisted")).toBe("true");
    expect(new URLSearchParams(last?.search).get("offset")).toBe("0");
  });

  it("states the totals in words beside the figures, including the waitlisted share", async () => {
    installApi(false);
    const container = mountRoster();
    await settle();

    const totals = container.querySelector('[role="group"][aria-label="Registration totals"]');
    expect(statFigures(totals)).toMatchObject({
      registered: { value: "1" },
      "in-person": { value: "1", note: "+1 waitlisted" },
    });
  });

  it("serves the roster the shared list contract describes", async () => {
    const captured: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith(`/events/${EVENT_ID}/registrations`)) {
          const body = registrationList();
          captured.push(body);
          return Promise.resolve(json(body));
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    const container = mountRoster();
    await settle();

    for (const body of captured) expect(() => eventAttendanceRegistrationsListResponseSchema.parse(body)).not.toThrow();
    expect(container.textContent).toContain("Group Member");
  });

  it("states the failure when the roster cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ error: { code: "server_error", message: "HTTP 500" } }, 500))),
    );
    const container = mountRoster();
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Something went wrong on our side.");
    expect(container.querySelector('section[aria-label="Registrations"]')).not.toBeNull();
  });
});

describe("group event registration record", () => {
  it("names the record after its attendee and states the type in the shared words", async () => {
    installApi(true);
    const container = mountRecord();
    await settle();
    await settle();

    const region = container.querySelector<HTMLElement>('section[aria-label="Registration for Group Member"]');
    expect(region).not.toBeNull();
    // The workspace owns h2; the record's subject is its h3.
    expect(region?.querySelector("h3")?.textContent).toBe("Group Member");
    expect(region?.textContent).toContain("member@example.test");
    expect(region?.textContent).toContain("1 day · 1 waitlisted");
    expect(region?.textContent).toContain("Registered directly");
    expect(region?.textContent).not.toContain("in_person");
    expect(region?.querySelector('[aria-label="Attendance by day"] h3')?.textContent).toBe("Attendance by day");
  });

  /** The open confirmation: the last dialog on the page, whatever its role. */
  function confirmDialog(): Element | null {
    const dialogs = document.querySelectorAll("dialog");
    return dialogs[dialogs.length - 1] ?? null;
  }

  /** The confirm dialog's button reading `label`. */
  function confirmButton(label: string): HTMLButtonElement {
    const found = [...(confirmDialog()?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no confirm dialog button reads "${label}"`);
    return found;
  }

  it("returns an accepted in-person day to its per-day waitlist through the canonical group route", async () => {
    const requests = installApi(false);
    const container = mountRecord();
    await settle();
    await settle();

    // Nothing stands open on the record: the day's commands sit behind its
    // own menu, and each asks before it acts (#113).
    expect(container.querySelector("select")).toBeNull();
    await openDayMenu(container);
    expect(menuItemNamed(container, "Change attendance…")).not.toBeNull();
    await act(async () => menuItemNamed(container, "Return to waitlist…")!.click());
    await settle();
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
    expect(confirmDialog()?.textContent).toContain("Return Day one to the waitlist?");
    await act(async () => confirmButton("Return to waitlist").click());
    await settle();

    expect(requests).toContainEqual(
      expect.objectContaining({
        path: `${REGISTRATION_ENDPOINT}/day-attendance`,
        method: "PATCH",
        body: { action: "waitlist", dayDates: ["2026-09-01"] },
      }),
    );
    expect(requests.some(({ path }) => path.endsWith(`/events/${EVENT_ID}/days`))).toBe(false);
    expect(requests.some(({ path }) => path.startsWith("/api/v1/admin/"))).toBe(false);
  });

  it("admits a selected waitlisted day without changing a registration-wide waitlist status", async () => {
    const requests = installApi(true);
    const container = mountRecord();
    await settle();
    await settle();

    await openDayMenu(container);
    await act(async () => menuItemNamed(container, "Admit from waitlist…")!.click());
    await settle();
    await act(async () => confirmButton("Admit from waitlist").click());
    await settle();

    expect(requests).toContainEqual(
      expect.objectContaining({
        path: `${REGISTRATION_ENDPOINT}/admissions`,
        method: "POST",
        body: {
          mode: "capacity_exempt",
          reason: "Event manager approved in-person admission",
          dayDates: ["2026-09-01"],
        },
      }),
    );
    expect(container.textContent).toContain("registration update email was queued");
    expect(requests.some(({ path }) => path.startsWith("/api/v1/admin/"))).toBe(false);
  });

  it("shows the capacity override only with event manage and sends its explicit selected-day payload", async () => {
    const hiddenRequests = installApi(false);
    const hidden = mountRecord(false);
    await settle();
    await settle();
    // Without event manage the record has no commands of its own — cancelling
    // is the only registration-level one — and the day's menu no override.
    expect(hidden.querySelector('button[aria-label="Registration actions"]')).toBeNull();
    await openDayMenu(hidden);
    expect(menuItemNamed(hidden, "Admit beyond capacity…")).toBeNull();
    expect(hiddenRequests.some(({ method }) => method === "POST")).toBe(false);

    vi.unstubAllGlobals();
    const requests = installApi(false);
    const container = mountRecord(true);
    await settle();
    await settle();

    // The override is the day's command and asks for its reason in a dialog,
    // never in a form standing open under the table (#113).
    expect(container.querySelector("dialog")).toBeNull();
    await openDayMenu(container);
    await act(async () => menuItemNamed(container, "Admit beyond capacity…")!.click());
    await settle();
    const dialog = container.querySelector<HTMLElement>("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Day one");
    const reason = controlFor<HTMLTextAreaElement>(dialog!, "Required reason");
    await act(async () => {
      reason.value = "Approved consortium guest";
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const applyButton = Array.from(dialog!.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Apply VIP override",
    );
    expect(applyButton?.disabled).toBe(false);
    await act(async () => {
      applyButton?.click();
    });
    await settle();

    expect(requests).toContainEqual(
      expect.objectContaining({
        path: `${REGISTRATION_ENDPOINT}/admissions`,
        method: "POST",
        body: { mode: "vip", reason: "Approved consortium guest", dayDates: ["2026-09-01"] },
      }),
    );
    expect(container.textContent).toContain("VIP override applied");
    expect(requests.some(({ path }) => path.startsWith("/api/v1/admin/"))).toBe(false);
  });

  it("moves the selected days to another attendance method from the list's bulk bar", async () => {
    const requests = installApi(false);
    const container = mountRecord(true);
    await settle();
    await settle();

    // Several days are changed the way every list changes several rows:
    // select them, then act on the selection (#113). No bar until then.
    expect(container.querySelector(".pk-bulk-bar")).toBeNull();
    const selectAll = container.querySelector<HTMLInputElement>('input[aria-label="Select all rows"]');
    expect(selectAll).not.toBeNull();
    await act(async () => selectAll!.click());
    await settle();
    expect(container.querySelector(".pk-bulk-bar")?.textContent).toContain("1 of 1 selected");
    const change = [...container.querySelectorAll<HTMLButtonElement>(".pk-bulk-bar button")].find(
      (candidate) => candidate.textContent?.trim() === "Change attendance…",
    );
    await act(async () => change!.click());
    await settle();
    const dialog = container.querySelector<HTMLElement>("dialog");
    expect(dialog).not.toBeNull();
    const method = controlFor<HTMLSelectElement>(dialog!, "Attendance method");
    await act(async () => {
      method.value = "livestream";
      method.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const confirm = [...dialog!.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Change attendance",
    );
    await act(async () => confirm!.click());
    await settle();

    // Every selected day in one request — one email — through the
    // day-attendance contract.
    expect(requests.filter(({ method: m }) => m === "PATCH")).toHaveLength(1);
    expect(requests).toContainEqual(
      expect.objectContaining({
        path: `${REGISTRATION_ENDPOINT}/day-attendance`,
        method: "PATCH",
        body: { action: "livestream", dayDates: ["2026-09-01"] },
      }),
    );
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector(".pk-bulk-bar")).toBeNull();
  });

  it("cancels the registration only through the confirm dialog, and only with event manage", async () => {
    const requests = installApi(false);
    const container = mountRecord(true);
    await settle();
    await settle();

    const commands = container.querySelector<HTMLButtonElement>('button[aria-label="Registration actions"]');
    await act(async () => commands!.click());
    await act(async () => menuItemNamed(container, "Cancel registration…")!.click());
    await settle();
    const dialog = confirmDialog();
    expect(dialog?.textContent).toContain("Cancel the registration for Group Member?");
    expect(requests.some(({ method, path }) => method === "PATCH" && path === REGISTRATION_ENDPOINT)).toBe(false);
    await act(async () => confirmButton("Cancel registration").click());
    await settle();

    expect(requests).toContainEqual(
      expect.objectContaining({ path: REGISTRATION_ENDPOINT, method: "PATCH", body: { action: "cancel" } }),
    );
  });

  it("states the failure when the registration cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ error: { code: "NOT_FOUND", message: "That registration is gone." } }, 404))),
    );
    const container = mountRecord();
    await settle();
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That registration is gone.");
  });
});
