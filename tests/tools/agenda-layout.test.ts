import { eventParticipationLink } from "../../assets/shared/event-participation-link";
import { describe, expect, it } from "vitest";
import type { ContentAgendaDay } from "../../assets/shared/site-agenda";
import { agendaRows } from "../../assets/ts/site/agenda-layout";

function schedule(): ContentAgendaDay {
  return {
    date: "2026-12-01",
    locations: [
      { id: "red", label: "Red hall" },
      { id: "blue", label: "Blue hall" },
    ],
    slots: [0, 30, 60].map((minute, index) => ({
      time: `09:${String(minute % 60).padStart(2, "0")}`,
      startsAt: new Date(Date.UTC(2026, 11, 1, 9, minute)).toISOString(),
      sessions: [
        {
          title: index === 0 ? "Long workshop" : "Talk",
          locations: [index === 0 ? "red" : "blue"],
          endsAt: new Date(Date.UTC(2026, 11, 1, 9, index === 0 ? 60 : minute + 30)).toISOString(),
          descriptionHtml: "",
          speakers: [],
        },
      ],
    })),
  };
}

describe("native agenda table layout", () => {
  it("sizes rows by elapsed minutes while keeping breaks compact", () => {
    const day = schedule();
    day.slots[2]!.startsAt = "2026-12-01T10:30:00.000Z";
    const rows = agendaRows(day);
    expect(rows[0]!.height).toBe(48);
    expect(rows[1]!.height).toBe(96);
    day.slots[1]!.sessions = [];
    day.slots[1]!.title = "Coffee break";
    day.slots[1]!.durationMinutes = 30;
    day.slots[2]!.startsAt = "2026-12-01T10:00:00.000Z";
    expect(agendaRows(day)[1]!.height).toBe(48);
  });

  it("reserves readable titles and speakers in a short session", () => {
    const day = schedule();
    day.slots[1]!.startsAt = "2026-12-01T09:05:00.000Z";
    day.slots[0]!.sessions[0]!.endsAt = "2026-12-01T09:05:00.000Z";
    day.slots[0]!.sessions[0]!.speakers = [{ name: "Chair" }, { name: "Moderator", moderator: true }];
    expect(agendaRows(day)[0]!.height).toBeGreaterThan(180);
  });

  it("reserves a long title, Markdown description and wrapped public actions in a short session", () => {
    const day = schedule();
    day.slots[1]!.startsAt = "2026-12-01T09:05:00.000Z";
    const session = day.slots[0]!.sessions[0]!;
    session.endsAt = day.slots[1]!.startsAt;
    const baseline = agendaRows(day)[0]!.height;
    session.title =
      "A practical roadmap for cryptographic agility: coordinating infrastructure, application teams, and standards through a multi-year transition";
    const longTitle = agendaRows(day)[0]!.height;
    expect(longTitle).toBeGreaterThan(baseline + 72);
    session.descriptionMarkdown = "**Practical lessons** and discussion for certificate operations.";
    const withDescription = agendaRows(day)[0]!.height;
    expect(withDescription).toBeGreaterThan(longTitle);
    session.sessionUrl = "/events/example/sessions/talk/";
    session.participation = eventParticipationLink("example", "session", "preference");
    const twoActions = agendaRows(day)[0]!.height;
    expect(twoActions).toBeGreaterThan(withDescription);
    session.presentationUrl = "/slides.pdf";
    session.recordingUrl = "https://example.test/recording";
    expect(agendaRows(day)[0]!.height).toBeGreaterThan(twoActions);
    expect(agendaRows(day)[0]!.cells[0]?.rowSpan).toBe(1);
    expect(agendaRows(day, 80)[0]!.height).toBeGreaterThan(agendaRows(day)[0]!.height);
  });

  it("keeps a long workshop in its room across the next parallel time slot", () => {
    const rows = agendaRows(schedule());
    expect(rows[0]!.cells[0]?.rowSpan).toBe(2);
    expect(rows[1]!.cells[0]).toBeNull();
    expect(rows[1]!.cells[1]?.sessions[0]?.title).toBe("Talk");
    expect(rows[2]!.cells[0]?.rowSpan).toBe(1);
  });

  it("does not span across a break or a new session in the same room", () => {
    const day = schedule();
    day.slots[1]!.sessions = [];
    day.slots[1]!.title = "Coffee break";
    day.slots[1]!.durationMinutes = 30;
    expect(agendaRows(day)[0]!.cells[0]?.rowSpan).toBe(1);
    expect(agendaRows(day, 80)[0]!.cells[0]?.rowSpan).toBe(1);
    expect(agendaRows(day)[1]!.height).toBe(48);
    day.slots[1]!.sessions = [{ ...day.slots[0]!.sessions[0]!, title: "Replacement" }];
    expect(agendaRows(day)[0]!.cells[0]?.rowSpan).toBe(1);
  });

  it("keeps unrelated end boundaries within the same public and editor session span", () => {
    const day = schedule();
    day.slots = [
      {
        startsAt: "2026-12-01T10:00:00.000Z",
        time: "10:00",
        sessions: [
          {
            ...day.slots[0]!.sessions[0]!,
            locations: ["blue"],
            endsAt: "2026-12-01T10:30:00.000Z",
          },
        ],
      },
      {
        startsAt: "2026-12-01T10:15:00.000Z",
        time: "10:15",
        sessions: [
          {
            ...day.slots[0]!.sessions[0]!,
            title: "A long discussion ".repeat(12),
            descriptionMarkdown: "Discussion notes",
            sessionUrl: "/sessions/discussion/",
            participation: eventParticipationLink("example", "session", "reservation"),
            locations: ["red"],
            endsAt: "2026-12-01T11:00:00.000Z",
          },
        ],
      },
      { startsAt: "2026-12-01T10:30:00.000Z", time: "10:30", sessions: [] },
      { startsAt: "2026-12-01T11:00:00.000Z", time: "11:00", sessions: [] },
    ];
    for (const controlsHeight of [0, 80]) {
      const rows = agendaRows(day, controlsHeight);
      expect(rows[1]!.cells[0]?.rowSpan).toBe(2);
      expect(rows[2]!.cells[0]).toBeNull();
      expect(rows[2]!.cells[1]?.sessions).toEqual([]);
      expect(rows[3]!.cells[0]).not.toBeNull();
      expect(rows[2]!.height).toBeGreaterThan(64);
      const unspanned = agendaRows({ ...day, slots: [day.slots[1]!] }, controlsHeight)[0]!.height;
      expect(unspanned).toBeGreaterThan(240);
      expect(rows[1]!.height + rows[2]!.height).toBeGreaterThanOrEqual(unspanned);
    }
    day.slots[1]!.sessions[0]!.endsAt = undefined;
    day.slots[1]!.sessions[0]!.endNotRecorded = true;
    expect(agendaRows(day)[1]!.cells[0]?.rowSpan).toBe(1);
  });

  it("allocates all eight workshop rooms without a fixed column limit", () => {
    const day = schedule();
    day.locations = Array.from({ length: 8 }, (_, index) => ({ id: `room-${index}`, label: `Room ${index}` }));
    day.slots[0]!.sessions[0]!.locations = ["room-7"];
    const cells = agendaRows(day)[0]!.cells;
    expect(cells).toHaveLength(8);
    expect(cells[7]?.sessions[0]?.title).toBe("Long workshop");
    expect(cells.slice(0, 7).every((cell) => cell?.sessions.length === 0)).toBe(true);
  });

  it("renders a session or configured break once across adjacent assigned rooms in both views", () => {
    const day = schedule();
    day.locations.push({ id: "green", label: "Green hall" });
    day.slots[0]!.sessions[0]!.locations = ["blue", "red"];
    day.slots[1]!.sessions = [];
    for (const kind of ["session", "break"] as const) {
      day.slots[0]!.sessions[0]!.kind = kind;
      for (const editor of [false, true]) {
        const rows = agendaRows(day, 0, editor);
        expect(rows[0]!.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
        expect(rows[0]!.cells[0]?.sessions).toEqual(day.slots[0]!.sessions);
        expect(rows[0]!.cells[1]).toBeNull();
        expect(rows[0]!.cells[2]).toMatchObject({ colSpan: 1, sessions: [] });
        expect(rows[1]!.cells.slice(0, 2)).toEqual([null, null]);
      }
    }
  });

  it("keeps nonadjacent placements separate without swallowing the parallel middle room", () => {
    const day = schedule();
    day.locations.push({ id: "green", label: "Green hall" });
    const shared = day.slots[0]!.sessions[0]!;
    shared.locations = ["red", "green"];
    const parallel = { ...shared, title: "Parallel talk", locations: ["blue"] };
    day.slots[0]!.sessions.push(parallel);
    const cells = agendaRows(day)[0]!.cells;
    expect(cells.map((cell) => cell?.colSpan)).toEqual([1, 1, 1]);
    expect(cells.map((cell) => cell?.sessions)).toEqual([[shared], [parallel], [shared]]);
  });

  it("does not merge a room that also has a distinct simultaneous session", () => {
    const day = schedule();
    const shared = day.slots[0]!.sessions[0]!;
    shared.locations = ["red", "blue"];
    const parallel = { ...shared, title: "Conflicting talk", locations: ["blue"] };
    day.slots[0]!.sessions.push(parallel);
    const cells = agendaRows(day)[0]!.cells;
    expect(cells[0]).toMatchObject({ colSpan: 1, sessions: [shared] });
    expect(cells[1]).toMatchObject({ colSpan: 1, sessions: [shared, parallel] });
  });

  it("stops a shared-room span before a later session in any covered room", () => {
    const day = schedule();
    day.slots[0]!.sessions[0]!.locations = ["red", "blue"];
    for (const editor of [false, true]) {
      const rows = agendaRows(day, 0, editor);
      expect(rows[0]!.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 1 });
      expect(rows[0]!.cells[1]).toBeNull();
      expect(rows[1]!.cells[1]?.sessions[0]?.title).toBe("Talk");
    }
  });
});
