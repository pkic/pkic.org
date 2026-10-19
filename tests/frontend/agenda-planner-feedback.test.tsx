// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgendaPlacementRefusal,
  agendaRefusalHeadline,
} from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaPlacementRefusal";
import { agendaSessionInteractions } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaSessionInteractions";
import { agendaSessionActions } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/session-actions";
import type { useAgendaScheduling } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/useAgendaScheduling";
import type { useAgendaTargetSelection } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/useAgendaTargetSelection";
import { agendaSnapshotSchema, type AgendaOccurrence } from "../../assets/shared/schemas/event-agenda";
import { pendingSpeakersLabel } from "../../assets/shared/proposal-speaker-acceptance";
import { AGENDA_ADMISSION_POLICY_LABELS } from "../../assets/shared/event-agenda-labels";
import { formatDateTimeInZone } from "../../assets/shared/format-date";
import { SessionParticipationFields } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionParticipationFields";

const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "Europe/Amsterdam",
  revision: 3,
  publishedRevision: null,
  rooms: [
    { id: "hall", name: "Hall", capacity: 100 },
    { id: "annex", name: "Annex", capacity: 40 },
  ],
  occurrences: [
    {
      id: "talk",
      title: "Synthetic talk",
      description: "",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T10:45:00.000Z",
      roomId: "hall",
      speakers: [],
      pendingSpeakerCount: 1,
    },
    {
      id: "registration",
      title: "Registration",
      description: "",
      kind: "break",
      startAt: "2026-12-01T08:00:00.000Z",
      endAt: "2026-12-01T09:00:00.000Z",
      roomId: "hall",
      additionalRoomIds: ["annex"],
      speakers: [],
    },
  ],
  shifts: [],
  roleMembers: [],
  assignments: [],
});

let host: HTMLElement;
function mount(node: preact.ComponentChild) {
  host = document.createElement("div");
  document.body.append(host);
  void act(() => render(node, host));
}
afterEach(() => {
  render(null, host);
  host.remove();
});

const scheduling = {
  canMoveRoom: (id: string, direction: -1 | 1) => id === "talk" && direction === 1,
  canMoveAdjacent: () => true,
  moveRoom: vi.fn(),
  moveAdjacent: vi.fn(),
  resizeStart: vi.fn(),
  setDuration: vi.fn(),
  timeStep: 5,
  durationOptions: [30, 45],
  actions: (session: AgendaOccurrence) =>
    session.kind === "break"
      ? [{ id: "unschedule", label: "Unschedule session" }]
      : [
          { id: "unschedule", label: "Unschedule session" },
          { id: "up", label: "Move before the previous session" },
          { id: "down", label: "Move after the next session" },
        ],
  move: vi.fn(),
  resize: vi.fn(),
} as unknown as ReturnType<typeof useAgendaScheduling>;

function interactions(occurrence: AgendaOccurrence) {
  return agendaSessionInteractions({
    occurrence,
    canEdit: true,
    canReview: true,
    locked: false,
    busy: false,
    target: { select: vi.fn() } as unknown as ReturnType<typeof useAgendaTargetSelection>,
    scheduling,
    cancelProposal: vi.fn(),
    actions: () => [],
  });
}

describe("planner feedback", () => {
  it("announces a refused move in a status line and opens the conflicts on request", async () => {
    const onDismiss = vi.fn();
    mount(<AgendaPlacementRefusal refusal={null} snapshot={snapshot} onDismiss={onDismiss} />);
    const status = host.querySelector('[role="status"]')!;
    expect(status.textContent).toBe("");
    void act(() =>
      render(
        <AgendaPlacementRefusal
          refusal={{
            message: "This change conflicts with the agenda",
            subject: "Synthetic talk",
            count: 1,
            details: { conflicts: ["Synthetic talk: Hall is unavailable for this session and setup time"] },
          }}
          snapshot={snapshot}
          onDismiss={onDismiss}
        />,
        host,
      ),
    );
    // The same live region now carries the refusal, so it is announced politely.
    expect(host.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toBe("“Synthetic talk” was not changed. This change conflicts with the agenda.");
    const toggle = [...host.querySelectorAll("button")].find((button) => button.textContent === "Show conflicts")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    void act(() => toggle.click());
    // The conflict details load on demand.
    await vi.waitFor(async () => {
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(host.textContent).toContain("Hall is unavailable");
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).not.toContain("Your changes have been kept");
    void act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close this notice"]')!.click());
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(agendaRefusalHeadline({ subject: "Keynote", count: 3 })).toBe("“Keynote” and 2 more were not changed.");
  });

  it("marks a session whose speakers have not all accepted, and offers only the moves that apply", () => {
    const talk = interactions(snapshot.occurrences[0]!);
    mount(
      <>
        {talk.notice}
        {talk.moveControls}
      </>,
    );
    expect(host.textContent).toContain(pendingSpeakersLabel(1));
    expect(pendingSpeakersLabel(1)).toBe("1 speaker not yet accepted");
    const labels = [...host.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Move Synthetic talk left",
      "Move Synthetic talk right",
      "Move Synthetic talk before the previous session",
      "Move Synthetic talk after the next session",
    ]);
    render(null, host);
    // A break across every location has no neighbor to move to and is a fixed barrier in the running order.
    const registration = interactions(snapshot.occurrences[1]!);
    expect(registration.notice).toBeNull();
    void act(() => render(<>{registration.moveControls}</>, host));
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  it("groups the session menu without slashes and marks only the commands that open a dialog", () => {
    const open = {
      duplicate: vi.fn(),
      history: vi.fn(),
      promotion: vi.fn(),
      participation: vi.fn(),
      move: vi.fn(),
      swap: vi.fn(),
      edit: vi.fn(),
      locations: vi.fn(),
    };
    const actions = agendaSessionActions(snapshot.occurrences[0]!, {
      canEdit: true,
      canReviewAppearances: false,
      busy: false,
      scheduling,
      open,
      select: vi.fn(),
    }).filter((action) => !["select", "resize", "bulk"].includes(action.id));
    expect(actions.map((action) => `${action.separatorBefore ? "| " : ""}${action.label}`)).toEqual([
      "Edit session…",
      "Duplicate session…",
      "| Move to another day or location…",
      "Change locations…",
      "Swap with another session…",
      "Unschedule session",
      "| Start 5 minutes earlier",
      "Start 5 minutes later",
      "Extend by 5 minutes",
      "Move before the previous session",
      "Move after the next session",
      "| Materials and archive",
      "Speaker promotion kit",
      "Participation and approvals",
    ]);
    expect(actions.some((action) => action.label.includes("/"))).toBe(false);
    expect(AGENDA_ADMISSION_POLICY_LABELS.preference).toBe("Open seating (first come, first served)");
  });

  it("reads a typed booking time back on the event clock instead of the picker's day order", () => {
    mount(
      <SessionParticipationFields
        draft={{
          policy: "preference",
          accessPolicy: "open",
          capacity: "",
          remoteCapacity: "",
          bookingOpensAt: "2026-11-20T09:30",
          bookingClosesAt: "",
        }}
        onChange={vi.fn()}
        timeZone="Europe/Amsterdam"
        of={() => ({})}
        disabled={false}
      />,
    );
    const help = [...host.querySelectorAll(".pk-field__help")].map((item) => item.textContent);
    expect(help).toContain(formatDateTimeInZone("2026-11-20T08:30:00.000Z", "Europe/Amsterdam"));
    expect(help).toContain("Optional. Amsterdam time.");
  });
});
