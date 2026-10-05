import { AgendaDropTarget } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaDropTarget";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionMove } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionMove";
import {
  adjustAgendaStart,
  snapAgendaStart,
  snapAgendaInstant,
} from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/schedule-time-controls";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { agendaScheduleProposalSchema } from "../../assets/shared/schemas/event-agenda-schedule";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "step-event",
  timeZone: "Europe/Amsterdam",
  revision: 4,
  publishedRevision: 3,
  rooms: [],
  blocks: [],
  roleMembers: [],
  assignments: [],
  occurrences: [
    {
      id: "session",
      title: "Session",
      description: "",
      roomId: null,
      startAt: "2026-12-01T09:07:00.000Z",
      endAt: "2026-12-01T09:37:00.000Z",
      speakers: [],
    },
  ],
});
let host: HTMLDivElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
});
describe("precise agenda time adjustments", () => {
  it("keeps typed times exact until an explicit snap and reviews a duration-preserving proposal", async () => {
    const requests: ReturnType<typeof agendaScheduleProposalSchema.parse>[] = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const proposal = agendaScheduleProposalSchema.parse(JSON.parse(String(init.body)));
      requests.push(proposal);
      return Response.json({
        expectedRevision: 4,
        reviewHash: "a".repeat(64),
        affected: proposal.changes.map((change) => ({
          before: snapshot.occurrences[0],
          after: { ...snapshot.occurrences[0], ...change },
          beforeOrder: 1,
          afterOrder: 1,
        })),
      });
    });
    vi.stubGlobal("fetch", fetcher);
    host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      render(
        <SessionMove snapshot={snapshot} session={snapshot.occurrences[0]!} onSaved={vi.fn()} onClose={vi.fn()} />,
        host,
      ),
    );
    const input = () => host.querySelector<HTMLInputElement>('[name="startAt"]')!;
    expect(input().value).toBe("2026-12-01T10:07");
    await act(() => {
      const step = host.querySelector<HTMLSelectElement>('[name="timeStep"]')!;
      step.value = "15";
      step.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(input().value).toBe("2026-12-01T10:07");
    const button = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>("button")].find((row) => row.textContent === label)!;
    await act(() => button("Later by 15 minutes").click());
    expect(input().value).toBe("2026-12-01T10:22");
    await act(() => button("Snap start to 15-minute grid").click());
    expect(input().value).toBe("2026-12-01T10:15");
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({
      expectedRevision: 4,
      changes: [
        {
          id: "session",
          startAt: "2026-12-01T09:15:00.000Z",
          endAt: "2026-12-01T09:45:00.000Z",
          roomId: null,
          additionalRoomIds: [],
        },
      ],
    });
  });
  it("uses one displayed snapped candidate for touch, keyboard activation and drag move/resize", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const move = vi.fn(),
      resize = vi.fn(),
      invalid = vi.fn(() => false);
    const props = {
      instant: "2026-12-01T09:07:00.000Z",
      roomId: "main",
      roomName: "Main",
      timeZone: "Europe/Amsterdam",
      timeStep: 15,
      dragged: "session",
      resizing: null,
      busy: false,
      invalidResize: invalid,
      move,
      resize,
    };
    await act(() => render(<AgendaDropTarget {...props} />, host));
    const target = host.querySelector("button")!;
    expect(target.textContent).toContain("10:00");
    await act(() => target.click());
    expect(move).toHaveBeenCalledExactlyOnceWith("session", "2026-12-01T09:00:00.000Z", "main");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { getData: (type: string) => (type === "text/plain" ? "dragged-session" : "") },
    });
    await act(() => {
      target.dispatchEvent(drop);
    });
    expect(move).toHaveBeenLastCalledWith("dragged-session", "2026-12-01T09:00:00.000Z", "main");
    await act(() => render(<AgendaDropTarget {...props} dragged={null} resizing="session" />, host));
    await act(() => host.querySelector("button")!.click());
    expect(resize).toHaveBeenCalledExactlyOnceWith("session", "2026-12-01T09:00:00.000Z", "main");
    invalid.mockReturnValue(true);
    await act(() => render(<AgendaDropTarget {...props} resizing="session" />, host));
    expect(host.querySelector("button")?.disabled).toBe(true);
    await act(() => host.querySelector("button")!.click());
    expect(resize).toHaveBeenCalledOnce();
  });
  it("uses the canonical zone codec through midnight and spring DST and rejects nonexistent typed times", () => {
    expect(adjustAgendaStart("2026-12-01T23:55", "Europe/Amsterdam", 15)).toBe("2026-12-02T00:10");
    expect(adjustAgendaStart("2026-03-29T01:55", "Europe/Amsterdam", 15)).toBe("2026-03-29T03:10");
    expect(snapAgendaStart("2026-12-01T23:58", "Europe/Amsterdam", 15)).toBe("2026-12-02T00:00");
    expect(snapAgendaInstant("2026-10-25T01:07:00.000Z", "Europe/Amsterdam", 15)).toBe("2026-10-25T01:00:00.000Z");
    expect(snapAgendaInstant("2026-12-01T09:07:00.000Z", "Asia/Kathmandu", 10)).toBe("2026-12-01T09:05:00.000Z");
    expect(() => adjustAgendaStart("2026-03-29T02:15", "Europe/Amsterdam", 15)).toThrow();
  });
});
