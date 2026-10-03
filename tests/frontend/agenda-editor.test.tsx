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
  blocks: [],
  roleMembers: [],
  assignments: [],
});
describe("shared agenda editor presentation", () => {
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
  it("uses stable occurrence identities and event wall time while escaping API descriptions", () => {
    const days = agendaPresenter(snapshot);
    expect(days[0].slots[0].time).toBe("11:00");
    expect(days[0].slots[0].sessions[0].id).toBe("session");
    expect(days[0].slots[0].sessions[0].descriptionHtml).toContain("&lt;script&gt;");
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
          session: () => ({ controls: <button>Edit session</button>, onDragStart: () => {} }),
          dropTarget: () => <button>Drop here</button>,
        }}
      />,
    );
    expect(output).toContain("Edit session");
    expect(output).toContain("Drop here");
    expect(output).toContain('draggable="true"');
    expect(output).toContain('data-agenda-occurrence="session"');
  });
});
