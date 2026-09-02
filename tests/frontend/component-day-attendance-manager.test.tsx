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
import { DayAttendanceManager } from "../../assets/ts/components/event-registrations/DayAttendanceManager";
import { controlFor } from "./helpers/labelled-control";

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

const dayAttendance: Detail["dayAttendance"] = [{ dayDate: DAY, attendanceType: "in_person", label: "Day one" }];
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
      <DayAttendanceManager
        dayAttendance={dayAttendance}
        dayWaitlist={overrides.dayWaitlist ?? waiting}
        eventDays={overrides.eventDays ?? eventDays}
        registrationEndpoint={REGISTRATION_ENDPOINT}
        canVip={overrides.canVip ?? false}
        onReload={overrides.onReload ?? (() => undefined)}
      />,
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

/**
 * The design system's choice control whose line reads `text`. Its label wraps
 * the control, so there is no `for` to resolve: the input inside is the one.
 */
function choice(container: HTMLElement, text: string): HTMLInputElement {
  const label = [...container.querySelectorAll<HTMLLabelElement>("label.pk-check")].find(
    (candidate) => candidate.querySelector(".pk-check__label")?.textContent === text,
  );
  const input = label?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`no choice reads "${text}"`);
  return input;
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
  it("admits a checked waitlisted day with a body the admission contract accepts", async () => {
    const requests = installApi();
    const reload = vi.fn();
    const container = mount({ onReload: reload });

    const admit = choice(container, "Admit day");
    expect(admit.disabled).toBe(false);
    await act(async () => {
      admit.click();
    });
    await click(button(container, "Admit selected days"));

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

    await click(button(container, "Return to waitlist"));

    const change = requests.find((request) => request.path === `${REGISTRATION_ENDPOINT}/day-attendance`);
    expect(change?.method).toBe("PATCH");
    const body = eventRegistrationDayAttendanceChangeSchema.parse(change?.body);
    expect(body).toEqual({ action: "waitlist", dayDates: [DAY] });
  });

  it("announces a rejected admission as an assertive message and keeps the selection", async () => {
    installApi({ fails: true });
    const container = mount();

    const admit = choice(container, "Admit day");
    await act(async () => {
      admit.click();
    });
    await click(button(container, "Admit selected days"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That day is no longer waitlisted.");
    // The words carry the failure; the tone only reinforces them.
    expect(container.textContent).not.toContain("registration update email was queued");
    expect(choice(container, "Admit day").checked).toBe(true);
  });

  it("names its table and wires the VIP reason to its own label and description", () => {
    installApi();
    const container = mount({ canVip: true });

    expect(container.querySelector("caption")?.textContent).toBe("Attendance by event day");

    // Resolved through the label's own for/id pair, so the lookup fails
    // exactly when the labelling contract does.
    const reason = controlFor<HTMLTextAreaElement>(container, "Required reason");
    expect(reason.tagName).toBe("TEXTAREA");
    expect(reason.required).toBe(true);
    const describedBy = reason.getAttribute("aria-describedby");
    expect(container.querySelector(`[id="${describedBy!}"]`)?.textContent).toContain("At least three");
    expect(reason.getAttribute("aria-invalid")).toBeNull();

    // Each day checkbox carries all three parts of the drawn control; only the
    // block class would render an operating-system default box.
    const vipDay = choice(container, `Day one — ${DAY}`);
    expect(vipDay.classList.contains("pk-check__input")).toBe(true);
    expect(vipDay.closest("label")?.classList.contains("pk-check")).toBe(true);
  });

  it("marks a too-short VIP reason invalid, announces why, and blocks the override", async () => {
    const requests = installApi();
    const container = mount({ canVip: true });

    const reason = controlFor<HTMLTextAreaElement>(container, "Required reason");
    const vipDay = choice(container, `Day one — ${DAY}`);
    await act(async () => {
      vipDay.click();
      reason.value = "no";
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // The verdict is the shared admission contract's own, shown once the
    // reader has touched the field and announced as a blocking error.
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    const message = container.querySelector('[role="alert"]');
    expect(message?.textContent).toMatch(/3/);
    expect(reason.getAttribute("aria-describedby")).toBe(message?.id);
    expect(button(container, "Apply VIP override").disabled).toBe(true);

    await click(button(container, "Apply VIP override"));
    expect(requests).toHaveLength(0);
  });

  it("applies a VIP override with a body the admission contract accepts", async () => {
    const requests = installApi();
    const reload = vi.fn();
    const container = mount({ canVip: true, onReload: reload });

    const reason = controlFor<HTMLTextAreaElement>(container, "Required reason");
    await act(async () => {
      choice(container, `Day one — ${DAY}`).click();
      reason.value = "Keynote speaker escort";
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // A reason the contract accepts is marked as such, not merely left blank.
    expect(reason.getAttribute("aria-invalid")).toBeNull();
    expect(button(container, "Apply VIP override").disabled).toBe(false);
    await click(button(container, "Apply VIP override"));

    const admission = requests.find((request) => request.path === `${REGISTRATION_ENDPOINT}/admissions`);
    const body = eventRegistrationSelectedDayAdmitSchema.parse(admission?.body);
    expect(body).toEqual({ mode: "vip", reason: "Keynote speaker escort", dayDates: [DAY] });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("VIP override applied to 1 day");
    // The form is spent: the reason is cleared for the next override.
    expect(controlFor<HTMLTextAreaElement>(container, "Required reason").value).toBe("");
  });

  it("says so rather than rendering an empty table when the event has no days", () => {
    installApi();
    const container = mount({ eventDays: [] });

    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("No event days configured.");
  });
});
