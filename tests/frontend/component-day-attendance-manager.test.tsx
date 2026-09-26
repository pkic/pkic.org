// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDay } from "../../assets/shared/schemas/event-configuration";
import {
  eventRegistrationDayAttendanceChangeSchema,
  eventRegistrationSelectedDayAdmitSchema,
  type EventRegistrationAttendanceDetailResponse,
} from "../../assets/shared/schemas/event-registration-detail";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { DayAttendanceManager } from "../../assets/ts/components/event-registrations/DayAttendanceManager";
import { controlFor } from "./helpers/labelled-control";
import { openRowMenu, runRowAction } from "./helpers/row-actions";

const REGISTRATION_ENDPOINT = "/api/v1/groups/g1/events/e1/registrations/r1";
const DAY = "2026-09-01";

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const eventDays: EventDay[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    date: DAY,
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
];

type Detail = EventRegistrationAttendanceDetailResponse;

const dayAttendance: Detail["dayAttendance"] = [
  {
    dayDate: DAY,
    attendanceType: "in_person",
    label: "Day one",
    heldSince: "2026-08-01T09:00:00.000Z",
    changedAt: "2026-08-20T15:30:00.000Z",
  },
];
const waiting: Detail["dayWaitlist"] = [
  { dayDate: DAY, status: "waiting", priorityLane: "general", offerExpiresAt: "2026-08-25T10:00:00.000Z" },
];

interface Captured {
  path: string;
  method: string;
  body: unknown;
}

function installApi(options: { fails?: boolean } = {}): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init.method ?? "GET";
      requests.push({
        path: url.pathname,
        method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (options.fails) {
        return Promise.resolve(
          json({ error: { code: "CAPACITY_CONFLICT", message: "That day is no longer waitlisted." } }, 409),
        );
      }
      if (url.pathname === `${REGISTRATION_ENDPOINT}/day-attendance`) return Promise.resolve(json({ success: true }));
      if (url.pathname === `${REGISTRATION_ENDPOINT}/admissions`) {
        return Promise.resolve(
          json({
            success: true,
            registration: {
              id: "30000000-0000-4000-8000-000000000001",
              event_id: "20000000-0000-4000-8000-000000000001",
              user_id: "40000000-0000-4000-8000-000000000001",
              user_email: "member@example.test",
              display_name: "Group Member",
              status: "registered",
              attendance_type: "in_person",
              source_type: "direct",
              created_at: "2026-08-01T00:00:00.000Z",
              updated_at: "2026-08-01T00:00:00.000Z",
            },
            admittedDayDates: [DAY],
          }),
        );
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}

function mount(
  overrides: Partial<{
    dayWaitlist: Detail["dayWaitlist"];
    eventDays: EventDay[];
    canVip: boolean;
    onReload: () => void | Promise<void>;
  }> = {},
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() =>
    render(
      <>
        <ConfirmDialogHost />
        <DayAttendanceManager
          dayAttendance={dayAttendance}
          dayWaitlist={overrides.dayWaitlist ?? waiting}
          eventDays={overrides.eventDays ?? eventDays}
          registrationEndpoint={REGISTRATION_ENDPOINT}
          canVip={overrides.canVip ?? false}
          onReload={overrides.onReload ?? (() => undefined)}
        />
      </>,
      container,
    ),
  );
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!found) throw new Error(`No button labelled "${text}"`);
  return found;
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("day attendance manager", () => {
  /**
   * The confirm dialog's control reading `label`. A confirmation that is not
   * destructive is a plain dialog, so it is found as the last dialog on the
   * page rather than by the alert role.
   */
  function confirmButton(label: string): HTMLButtonElement {
    const dialogs = document.querySelectorAll("dialog");
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) throw new Error("no confirm dialog is open");
    return button(dialog as unknown as HTMLElement, label);
  }

  /** The confirmation's text, once the host has rendered it. */
  async function confirmText(): Promise<string> {
    await settle();
    const dialogs = document.querySelectorAll("dialog");
    return dialogs[dialogs.length - 1]?.textContent ?? "";
  }

  /** The override dialog's control reading `label`. */
  function dialogButton(container: HTMLElement, label: string): HTMLButtonElement {
    const dialog = container.querySelector("dialog");
    if (!dialog) throw new Error("no dialog is open");
    return button(dialog as unknown as HTMLElement, label);
  }

  it("admits a waitlisted day from its row's menu once the manager confirms, with a body the admission contract accepts", async () => {
    const requests = installApi();
    const reload = vi.fn();
    const container = mount({ onReload: reload });

    await runRowAction(container, "Day one", "Admit from waitlist…");
    // Nothing is written on choosing the command: the dialog states the day
    // and that one email goes out, and the write follows the confirmation.
    expect(await confirmText()).toContain("Admit Day one from the waitlist?");
    expect(requests).toHaveLength(0);
    await click(confirmButton("Admit from waitlist"));

    const admission = requests.find((request) => request.path === `${REGISTRATION_ENDPOINT}/admissions`);
    expect(admission?.method).toBe("POST");
    const body = eventRegistrationSelectedDayAdmitSchema.parse(admission?.body);
    expect(body.mode).toBe("capacity_exempt");
    expect(body.dayDates).toEqual([DAY]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("registration update email was queued");
  });

  it("returns an accepted day to its waitlist through the day-attendance contract", async () => {
    const requests = installApi();
    const container = mount({ dayWaitlist: [] });

    await runRowAction(container, "Day one", "Return to waitlist…");
    expect(await confirmText()).toContain("Return Day one to the waitlist?");
    await click(confirmButton("Return to waitlist"));

    const change = requests.find((request) => request.path === `${REGISTRATION_ENDPOINT}/day-attendance`);
    expect(change?.method).toBe("PATCH");
    const body = eventRegistrationDayAttendanceChangeSchema.parse(change?.body);
    expect(body).toEqual({ action: "waitlist", dayDates: [DAY] });
  });

  it("changes one day's method through the same dialog the selection uses, never on the menu click", async () => {
    const requests = installApi();
    const container = mount({ dayWaitlist: [] });

    await runRowAction(container, "Day one", "Change attendance…");
    expect(requests).toHaveLength(0);
    const method = controlFor<HTMLSelectElement>(container, "Attendance method");
    // The day is held in person, so in person is not offered as a change.
    expect([...method.options].map((option) => option.value)).toEqual(["livestream"]);
    await click(dialogButton(container, "Change attendance"));

    const change = requests.find((request) => request.path === `${REGISTRATION_ENDPOINT}/day-attendance`);
    expect(eventRegistrationDayAttendanceChangeSchema.parse(change?.body)).toEqual({
      action: "livestream",
      dayDates: [DAY],
    });
    expect(container.textContent).toContain("1 day changed to live stream");
  });

  it("acts on every selected day at once from the bulk bar, in one request", async () => {
    const requests = installApi();
    const secondDay: EventDay = {
      ...eventDays[0],
      id: "50000000-0000-4000-8000-000000000002",
      date: "2026-09-02",
      label: "Day two",
    };
    const container = mount({ dayWaitlist: [], eventDays: [eventDays[0], secondDay] });

    expect(container.querySelector(".pk-bulk-bar")).toBeNull();
    await click(container.querySelector<HTMLInputElement>('input[aria-label="Select all rows"]')!);
    expect(container.querySelector(".pk-bulk-bar")?.textContent).toContain("2 of 2 selected");
    // The bar offers what applies to the selection: the days differ (one
    // held, one not), so leaving applies to the held one and is offered.
    await click(button(container.querySelector(".pk-bulk-bar") as HTMLElement, "Change attendance…"));
    await click(dialogButton(container, "Change attendance"));

    const changes = requests.filter((request) => request.path === `${REGISTRATION_ENDPOINT}/day-attendance`);
    expect(changes).toHaveLength(1);
    expect(eventRegistrationDayAttendanceChangeSchema.parse(changes[0].body).dayDates).toEqual([DAY, "2026-09-02"]);
    // The selection is spent with the change.
    expect(container.querySelector(".pk-bulk-bar")).toBeNull();
  });

  it("offers only the commands that apply to the day, and nothing stands open on the page", async () => {
    installApi();
    const container = mount({ dayWaitlist: [], canVip: true });

    // The day is held in person: the other option, the waitlist, the
    // override and leaving are offered; admitting from a waitlist it is not
    // on is not (#113). Every command asks before it acts.
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("In-person");
    await openRowMenu(container, "Day one");
    expect([...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())).toEqual([
      "Change attendance…",
      "Return to waitlist…",
      "Admit beyond capacity…",
      "Not attending…",
    ]);
  });

  it("states when each day last changed, and since when it has been held if that is another day", () => {
    installApi();
    const container = mount();

    const headers = [...container.querySelectorAll("th")].map((cell) => cell.textContent?.trim());
    expect(headers).toEqual(expect.arrayContaining(["Last changed"]));
    const row = container.querySelector("tbody tr");
    // The fixture was first held on 1 August and last changed on 20 August.
    expect(row?.textContent).toContain("Held since");
    expect(row?.textContent).toMatch(/Aug(ust)? 20|20 Aug|8\/20/);
  });

  it("announces a rejected admission as an assertive message", async () => {
    installApi({ fails: true });
    const container = mount();

    await runRowAction(container, "Day one", "Admit from waitlist…");
    await confirmText();
    await click(confirmButton("Admit from waitlist"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That day is no longer waitlisted.");
    // The words carry the failure; the tone only reinforces them.
    expect(container.textContent).not.toContain("registration update email was queued");
  });

  it("names its table and, in the override dialog, names the day and wires the reason to its own label and description", async () => {
    installApi();
    const container = mount({ canVip: true });

    expect(container.querySelector("caption")?.textContent).toBe("Attendance by event day");
    // The override is a dialog the row's command opens, not a form on the page.
    expect(container.querySelector("dialog")).toBeNull();
    await runRowAction(container, "Day one", "Admit beyond capacity…");

    // The dialog says which day it is about; there is nothing to pick.
    expect(container.querySelector("dialog")?.textContent).toContain("Day one");
    expect(container.querySelector("dialog input[type='checkbox']")).toBeNull();
    // Resolved through the label's own for/id pair, so the lookup fails
    // exactly when the labelling contract does.
    const reason = controlFor<HTMLTextAreaElement>(container, "Required reason");
    expect(reason.tagName).toBe("TEXTAREA");
    expect(reason.required).toBe(true);
    const describedBy = reason.getAttribute("aria-describedby");
    expect(container.querySelector(`[id="${describedBy!}"]`)?.textContent).toContain("At least three");
    expect(reason.getAttribute("aria-invalid")).toBeNull();
  });

  it("marks a too-short VIP reason invalid, announces why, and blocks the override", async () => {
    const requests = installApi();
    const container = mount({ canVip: true });
    await runRowAction(container, "Day one", "Admit beyond capacity…");

    const reason = controlFor<HTMLTextAreaElement>(container, "Required reason");
    await act(async () => {
      reason.value = "no";
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // The verdict is the shared admission contract's own, shown once the
    // reader has touched the field and announced as a blocking error.
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    const message = container.querySelector('dialog [role="alert"]');
    expect(message?.textContent).toMatch(/3/);
    expect(reason.getAttribute("aria-describedby")).toBe(message?.id);
    expect(dialogButton(container, "Apply VIP override").disabled).toBe(true);

    await click(dialogButton(container, "Apply VIP override"));
    expect(requests).toHaveLength(0);
  });

  it("applies a VIP override with a body the admission contract accepts and closes the dialog", async () => {
    const requests = installApi();
    const reload = vi.fn();
    const container = mount({ canVip: true, onReload: reload });
    await runRowAction(container, "Day one", "Admit beyond capacity…");

    const reason = controlFor<HTMLTextAreaElement>(container, "Required reason");
    await act(async () => {
      reason.value = "Keynote speaker escort";
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // A reason the contract accepts is marked as such, not merely left blank.
    expect(reason.getAttribute("aria-invalid")).toBeNull();
    expect(dialogButton(container, "Apply VIP override").disabled).toBe(false);
    await click(dialogButton(container, "Apply VIP override"));

    const admission = requests.find((request) => request.path === `${REGISTRATION_ENDPOINT}/admissions`);
    const body = eventRegistrationSelectedDayAdmitSchema.parse(admission?.body);
    expect(body).toEqual({ mode: "vip", reason: "Keynote speaker escort", dayDates: [DAY] });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("VIP override applied to 1 day");
    // The dialog is spent: nothing of it stays on the page.
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("says so rather than rendering an empty table when the event has no days", () => {
    installApi();
    const container = mount({ eventDays: [] });

    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("No event days configured.");
  });
});
