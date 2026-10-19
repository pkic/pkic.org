// @vitest-environment jsdom
import { render as html } from "preact-render-to-string";
import { describe, it, expect } from "vitest";
import { agendaRows } from "../../assets/ts/site/agenda-layout";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { agendaPresenter } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/presenter";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "Europe/Amsterdam",
  revision: 1,
  publishedRevision: null,
  rooms: [{ id: "room", name: "Blue hall", capacity: 80 }],
  occurrences: [
    {
      id: "session",
      title: "Cryptography workshop",
      description: "<script>unsafe</script>",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T10:30:00.000Z",
      roomId: "room",
      speakers: [],
    },
  ],
  shifts: [],
  roleMembers: [],
  assignments: [],
});
describe("shared agenda editor presentation", () => {
  it("keeps timed global breaks and location-TBA sessions in the shared day agenda", () => {
    const global = {
      ...snapshot.occurrences[0],
      title: "Coffee and conversations",
      kind: "break" as const,
      roomId: null,
    };
    const days = agendaPresenter({ ...snapshot, occurrences: [global] });
    expect(days).toHaveLength(1);
    expect(days[0].slots[0].sessions[0].locations).toEqual([]);
    expect(days[0].slots[0].sessions[0].id).toBe(global.id);
    const output = html(<ContentAgenda days={days} speakers={[]} timeZone={snapshot.timeZone} />);
    expect(output).toContain("Coffee and conversations");
    expect(output).toContain("11:00");
  });
  it("keeps portal sessions spanning an empty boundary until their actual end", () => {
    const day = agendaPresenter({
      ...snapshot,
      occurrences: [
        { ...snapshot.occurrences[0], startAt: "2026-12-01T10:15:00.000Z", endAt: "2026-12-01T11:00:00.000Z" },
        {
          ...snapshot.occurrences[0],
          id: "other",
          roomId: "other-room",
          startAt: "2026-12-01T09:00:00.000Z",
          endAt: "2026-12-01T10:30:00.000Z",
        },
      ],
      rooms: [...snapshot.rooms, { id: "other-room", name: "Workshop", capacity: 80, setupMinutes: 0 }],
    })[0];
    const rows = agendaRows(day, 80);
    const start = rows.findIndex((row) => row.slot.time === "11:15");
    expect(rows[start].cells[0]?.rowSpan).toBe(2);
    expect(rows[start + 1].slot.time).toBe("11:30");
    expect(rows[start + 1].cells[0]).toBeNull();
    expect(rows[start + 2].slot.time).toBe("12:00");
    expect(rows[start + 2].cells[0]?.sessions).toEqual([]);
  });
  it("uses stable identities and renders API Markdown safely through the shared public presenter", () => {
    const days = agendaPresenter({
      ...snapshot,
      occurrences: [
        {
          ...snapshot.occurrences[0],
          description:
            "**Practical controls**\n\n- Certificate lifecycle\n- [Unsafe](javascript:alert(1))\n\n<script>unsafe</script>",
        },
      ],
    });
    expect(days[0].slots[0].time).toBe("11:00");
    expect(days[0].slots[0].sessions[0].id).toBe("session");
    expect(days[0].slots[0].sessions[0].descriptionHtml).toBe("");
    const output = html(<ContentAgenda days={days} speakers={[]} timeZone={snapshot.timeZone} />);
    expect(output).toContain("<strong>Practical controls</strong>");
    expect(output).toContain("<li>Certificate lifecycle</li>");
    const rendered = document.createElement("div");
    rendered.innerHTML = output;
    expect(rendered.textContent).toContain("<script>unsafe</script>");
    expect(rendered.querySelector("script")).toBeNull();
    expect(output).not.toContain('href="javascript:');
    expect(output).not.toContain("<script>unsafe</script>");
  });
  it("reserves content space for portal controls without changing public geometry", () => {
    const day = agendaPresenter({
      ...snapshot,
      occurrences: [{ ...snapshot.occurrences[0], endAt: "2026-12-01T10:05:00.000Z" }],
    })[0];
    const publicRows = agendaRows(day);
    const editorRows = agendaRows(day, 80);
    expect(editorRows[0].height).toBeGreaterThan(publicRows[0].height);
    expect(agendaRows(day)[0].height).toBe(publicRows[0].height);
  });
  it("public agenda remains complete HTML without portal controls or drag behavior", () => {
    const output = html(<ContentAgenda days={agendaPresenter(snapshot)} speakers={[]} timeZone={snapshot.timeZone} />);
    expect(output).toContain("Cryptography workshop");
    expect(output).not.toContain("Edit session");
    expect(output).not.toContain("Edit session details");
    expect(output).not.toContain("pk-row-actions");
    expect(output).not.toContain("Drop here");
    expect(output).not.toContain('draggable="true"');
  });
  it("adds controls only through the explicit portal editor boundary", () => {
    const output = html(
      <ContentAgenda
        days={agendaPresenter(snapshot)}
        speakers={[]}
        timeZone={snapshot.timeZone}
        editor={{
          session: () => ({
            controls: <button>Edit session</button>,
            detailControls: () => <button>Edit session details</button>,
            onDragStart: () => {},
          }),
          dropTarget: () => <button>Drop here</button>,
        }}
      />,
    );
    expect(output).toContain("Edit session");
    const rendered = document.createElement("div");
    rendered.innerHTML = output;
    expect(rendered.querySelector("dialog .session-modal__header")?.textContent).toContain("Edit session details");
    expect(output).toContain("Drop here");
    expect(output).toContain('draggable="true"');
    expect(output).toContain('data-agenda-occurrence="session"');
  });
});

function breakSchedule() {
  return agendaSnapshotSchema.parse({
    ...snapshot,
    timeZone: "UTC",
    eventStartsAt: "2026-12-01T10:00:00.000Z",
    eventEndsAt: "2026-12-01T12:00:00.000Z",
    rooms: [...snapshot.rooms, { id: "green", name: "Green hall", capacity: 80 }],
    occurrences: [
      {
        ...snapshot.occurrences[0],
        id: "break",
        kind: "break",
        title: "Lunch",
        description: "",
        roomId: null,
        endAt: "2026-12-01T11:00:00.000Z",
      },
      {
        ...snapshot.occurrences[0],
        id: "after",
        description: "",
        startAt: "2026-12-01T11:00:00.000Z",
        endAt: "2026-12-01T12:00:00.000Z",
      },
    ],
  });
}

describe("compact fully covered break intervals", () => {
  it("keeps all twelve UTC ticks and the exact end boundary while making a one-hour bar 52px plus insets", () => {
    const data = breakSchedule();
    const day = agendaPresenter(data)[0]!;
    const before = JSON.stringify({ data, day });
    for (const calendar of [false, true]) {
      const rows = agendaRows(day, 0, calendar);
      const covered = rows.filter((row) => row.compactBreak);
      expect(covered).toHaveLength(12);
      expect(covered.reduce((height, row) => height + row.height, 0)).toBe(60);
      expect(covered[0]!.cells[0]?.rowSpan).toBe(12);
      expect(covered[0]!.cells[0]?.colSpan).toBe(2);
      expect(covered.slice(1).every((row) => row.breakInterior)).toBe(true);
      expect(rows[12]!.slot.startsAt).toBe("2026-12-01T11:00:00.000Z");
      expect(rows[12]!.compactBreak).toBe(false);
    }
    const rendered = document.createElement("div");
    rendered.innerHTML = html(
      <ContentAgenda
        days={[day]}
        speakers={[]}
        timeZone="UTC"
        editor={{
          session: () => ({ controls: null }),
          dropTarget: (instant) => <button data-test-drop={instant}>Drop</button>,
        }}
      />,
    );
    const ticks = [...rendered.querySelectorAll<HTMLElement>("tr[data-agenda-compact-break]")];
    expect(ticks.map((tick) => tick.dataset.agendaStart)).toEqual(day.slots.slice(0, 12).map((slot) => slot.startsAt));
    expect(ticks.at(-1)!.dataset.agendaEnd).toBe("2026-12-01T11:00:00.000Z");
    expect(ticks.every((tick) => tick.querySelector("button[data-test-drop]"))).toBe(true);
    expect(
      ticks
        .slice(1)
        .every((tick) => tick.querySelector(".pk-content-agenda__clocks")?.classList.contains("pk-sr-only")),
    ).toBe(true);
    expect(JSON.stringify({ data, day })).toBe(before);
  });

  it("compresses matching room-specific breaks only when they collectively cover every room", () => {
    const data = breakSchedule();
    data.occurrences[0]!.roomId = "room";
    data.occurrences.push({ ...data.occurrences[0]!, id: "green-break", roomId: "green" });
    const rows = agendaRows(agendaPresenter(data)[0]!, 0, true);
    expect(rows.filter((row) => row.compactBreak).reduce((sum, row) => sum + row.height, 0)).toBe(60);
    expect(rows[0]!.cells.filter(Boolean)).toHaveLength(2);
    expect(rows[0]!.cells.every((cell) => cell?.rowSpan === 12)).toBe(true);
    data.occurrences.pop();
    expect(agendaRows(agendaPresenter(data)[0]!, 0, true).some((row) => row.compactBreak)).toBe(false);
  });

  it("keeps mixed-room normal sessions and their content floor uncompressed", () => {
    const data = breakSchedule();
    data.occurrences[0]!.roomId = "room";
    data.occurrences.push({
      ...data.occurrences[1]!,
      id: "parallel",
      roomId: "green",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T11:00:00.000Z",
    });
    const rows = agendaRows(agendaPresenter(data)[0]!, 0, true);
    expect(rows.some((row) => row.compactBreak)).toBe(false);
    expect(rows.slice(0, 12).reduce((sum, row) => sum + row.height, 0)).toBeGreaterThan(60);
  });

  it("refuses to compress unknown ends, richer bodies, and a missing terminal slot boundary", () => {
    const day = agendaPresenter(breakSchedule())[0]!;
    const unknown = structuredClone(day);
    unknown.slots[0]!.sessions[0]!.endNotRecorded = true;
    expect(agendaRows(unknown, 0, true).some((row) => row.compactBreak)).toBe(false);
    const rich = structuredClone(day);
    rich.slots[0]!.sessions[0]!.descriptionMarkdown = "Actual break description with attendee instructions.";
    expect(agendaRows(rich, 0, true).some((row) => row.compactBreak)).toBe(false);
    const missing = structuredClone(day);
    missing.slots = missing.slots.filter((slot) => slot.startsAt < "2026-12-01T11:00:00.000Z");
    expect(agendaRows(missing, 0, true).some((row) => row.compactBreak)).toBe(false);
  });

  it("retains at least one pixel per tick for a very long break", () => {
    const data = breakSchedule();
    data.eventEndsAt = "2026-12-01T17:00:00.000Z";
    data.occurrences[0]!.endAt = "2026-12-01T16:00:00.000Z";
    data.occurrences[1]!.startAt = "2026-12-01T16:00:00.000Z";
    data.occurrences[1]!.endAt = data.eventEndsAt;
    const covered = agendaRows(agendaPresenter(data)[0]!, 0, true).filter((row) => row.compactBreak);
    expect(covered).toHaveLength(72);
    expect(covered.every((row) => row.height >= 1)).toBe(true);
    expect(covered.reduce((sum, row) => sum + row.height, 0)).toBe(72);
  });
});
