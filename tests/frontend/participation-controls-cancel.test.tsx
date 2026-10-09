// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  personalAgendaResponseSchema,
  personalAgendaSessionSchema,
} from "../../assets/shared/schemas/event-personal-agenda";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { confirmAction } from "../../assets/ts/components/ConfirmDialog";
import { ParticipationControls } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/ParticipationControls";

vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: vi.fn(async () => true) }));

const SESSION = "10000000-0000-4000-8000-000000000001";
const ROOM_A = "10000000-0000-4000-8000-000000000002";
const ROOM_B = "10000000-0000-4000-8000-000000000003";

function session(overrides: Record<string, unknown> = {}) {
  return personalAgendaSessionSchema.parse({
    id: SESSION,
    publishedRevision: 3,
    title: "Hands-on workshop",
    roomId: ROOM_A,
    rooms: [
      { id: ROOM_A, name: "Room A" },
      { id: ROOM_B, name: "Room B" },
    ],
    timeZone: "UTC",
    startAt: "2027-01-20T09:00:00.000Z",
    endAt: "2027-01-20T10:00:00.000Z",
    admissionPolicy: "optional_reservation",
    status: "reserved",
    attendanceMode: "physical",
    availability: [ROOM_A, ROOM_B].map((roomId) => ({
      attendanceMode: "physical",
      roomId,
      state: "available",
      message: "A place is available.",
      bookingAction: "reserve",
      canSave: true,
    })),
    ...overrides,
  });
}

const hosts: HTMLElement[] = [];
const bodies: ReturnType<typeof sessionParticipationRequestSchema.parse>[] = [];

function mount(value: ReturnType<typeof session>, onSaved = vi.fn()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        bodies.push(sessionParticipationRequestSchema.parse(JSON.parse(String(init.body))));
        return Response.json(
          sessionParticipationResponseSchema.parse({ status: "reserved", attendanceMode: "physical" }),
        );
      }
      return Response.json(
        personalAgendaResponseSchema.parse({ sessions: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } }),
      );
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<ParticipationControls slug="workshop" session={value} onSaved={onSaved} />, host));
  return host;
}

function button(host: HTMLElement, label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label);
}

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

describe("session participation controls", () => {
  it.each(["optional_reservation", "reservation", "approval"] as const)(
    "never offers cancellation in the %s participation choice",
    (admissionPolicy) => {
      const host = mount(
        session({
          admissionPolicy,
          availability: [ROOM_A, ROOM_B].map((roomId) => ({
            attendanceMode: "physical",
            roomId,
            state: "available",
            message: "A place is available.",
            bookingAction: admissionPolicy === "approval" ? "request" : "reserve",
            canSave: true,
          })),
        }),
      );
      const select = host.querySelector<HTMLSelectElement>('select[name="action"]')!;
      expect([...select.options].map((option) => option.value)).not.toContain("cancel");
      expect(select.value).toBe(admissionPolicy === "approval" ? "request" : "reserve");
    },
  );

  it("changes only the location with the default submission and never cancels", async () => {
    const onSaved = vi.fn();
    const host = mount(session(), onSaved);
    await act(async () => {
      const room = host.querySelector<HTMLSelectElement>('select[name="roomId"]')!;
      room.value = ROOM_B;
      room.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(host, "Update")!.click());
    await settle();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ action: "reserve", roomId: ROOM_B, expectedPublishedRevision: 3 });
    expect(confirmAction).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("cancels only through its own confirmed action, for the place the viewer holds", async () => {
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    const host = mount(session());
    const cancel = button(host, "Cancel my session registration…")!;
    expect(cancel.type).toBe("button");
    expect(cancel.classList.contains("pk-btn--danger-quiet")).toBe(true);

    await act(async () => cancel.click());
    await settle();
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Cancel your registration for Hands-on workshop?",
        confirmLabel: "Cancel registration",
        tone: "danger",
      }),
    );
    expect(bodies).toHaveLength(0);

    // A location the viewer is merely looking at does not change which place is released.
    await act(async () => {
      const room = host.querySelector<HTMLSelectElement>('select[name="roomId"]')!;
      room.value = ROOM_B;
      room.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(host, "Cancel my session registration…")!.click());
    await settle();
    expect(confirmAction).toHaveBeenCalledTimes(2);
    expect(bodies).toEqual([{ action: "cancel", attendanceMode: "physical", roomId: ROOM_A }]);
  });

  it("offers no cancellation without a registration, and no booking command for a preference-only session", () => {
    const unregistered = mount(session({ status: null }));
    expect(button(unregistered, "Cancel my session registration…")).toBeUndefined();
    expect(button(unregistered, "Update")).toBeDefined();

    const preference = mount(
      session({
        admissionPolicy: "preference",
        availability: [ROOM_A, ROOM_B].map((roomId) => ({
          attendanceMode: "physical",
          roomId,
          state: "available",
          message: "Save a preference.",
          bookingAction: null,
          canSave: true,
        })),
      }),
    );
    expect(preference.querySelector('select[name="action"]')).toBeNull();
    expect(button(preference, "Update")).toBeUndefined();
    expect(button(preference, "Cancel my session registration…")).toBeDefined();
  });
});
