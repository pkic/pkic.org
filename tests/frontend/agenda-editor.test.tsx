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
