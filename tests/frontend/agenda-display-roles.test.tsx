// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { agendaDisplayRoles } from "../../assets/shared/event-agenda-display-roles";
import { agendaPresenter } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/presenter";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";

describe("shared shift duty display", () => {
  it("shows scoped duties and freezes only public display fields", () => {
    const startAt = "2026-12-01T09:00:00.000Z",
      endAt = "2026-12-01T10:00:00.000Z";
    const snapshot = agendaSnapshotSchema.parse({
      eventSlug: "synthetic",
      timeZone: "Europe/Amsterdam",
      revision: 1,
      publishedRevision: null,
      rooms: [
        { id: "hall", name: "Main hall", capacity: 50 },
        { id: "private", name: "Private room", capacity: 5 },
      ],
      occurrences: [{ id: "talk", title: "Public talk", startAt, endAt, roomId: "hall", speakers: [] }],
      shifts: ["hall", "private"].map((roomId) => ({
        id: roomId,
        name: `${roomId} opening`,
        startAt,
        endAt,
        roomId,
        roles: ["mc"],
      })),
      roleMembers: [
        {
          userId: "person",
          displayName: "Synthetic Host",
          roles: ["mc"],
          availableFrom: null,
          availableUntil: null,
          maxMinutes: null,
        },
      ],
      staffingRoles: [{ id: "mc", name: "Conference host", showOnAgenda: true }],
      assignments: ["hall", "private"].map((shiftId) => ({
        positionId: `${shiftId}-mc`,
        postId: null,
        shiftId,
        role: "mc",
        userId: "person",
        pinned: true,
      })),
    });
    const publicRoles = agendaDisplayRoles(snapshot, "2026-12-01", true);
    expect(publicRoles).toHaveLength(1);
    expect(publicRoles[0].duties).toEqual([{ role: "Conference host", displayName: "Synthetic Host" }]);
    expect(JSON.stringify(publicRoles)).not.toMatch(/pinned|userId|maxMinutes|seniority/);
    const approved = { ...snapshot, displayRoles: publicRoles, shifts: [], roleMembers: [], assignments: [] };
    expect(agendaDisplayRoles(approved, "2026-12-01", true)).toEqual(publicRoles);
    const html = render(<ContentAgenda days={agendaPresenter(snapshot)} speakers={[]} timeZone={snapshot.timeZone} />);
    expect(html).toContain("Shift hosts and question support");
    expect(html).toContain("Synthetic Host");
    expect(html).toContain("10:00");
    expect(html).not.toContain("pinned");
  });
  it("publishes only explicitly visible role names and keeps operational roles in the editing view", () => {
    const startAt = "2027-01-01T09:00:00.000Z",
      endAt = "2027-01-01T10:00:00.000Z";
    const snapshot = agendaSnapshotSchema.parse({
      eventSlug: "custom-roles",
      timeZone: "UTC",
      revision: 0,
      publishedRevision: null,
      rooms: [],
      occurrences: [{ id: "session", title: "Public session", startAt, endAt, roomId: null, speakers: [] }],
      shifts: [
        {
          id: "opening",
          name: "Opening",
          startAt,
          endAt,
          roomId: null,
          roles: ["host-id", "scanner-id", "private-door-id"],
        },
      ],
      staffingRoles: [
        { id: "host-id", name: "Morning conference host", showOnAgenda: true },
        { id: "scanner-id", name: "Badge scanning" },
        { id: "private-door-id", name: "Door admission", showOnAgenda: false },
      ],
      roleMembers: ["host", "scanner", "door"].map((userId, index) => ({
        userId,
        displayName: `Assigned ${userId}`,
        roles: [["host-id", "scanner-id", "private-door-id"][index]],
        availableFrom: null,
        availableUntil: null,
        maxMinutes: null,
      })),
      assignments: ["host", "scanner", "door"].map((userId, index) => ({
        positionId: `secret-position-${index}`,
        postId: index ? `secret-door-${index}` : null,
        shiftId: "opening",
        role: ["host-id", "scanner-id", "private-door-id"][index],
        userId,
        pinned: true,
      })),
    });
    const publicRoles = agendaDisplayRoles(snapshot, "2027-01-01", true);
    expect(publicRoles[0].duties).toEqual([{ role: "Morning conference host", displayName: "Assigned host" }]);
    expect(JSON.stringify(publicRoles)).not.toMatch(
      /host-id|scanner|private-door|secret-position|secret-door|userId|pinned/,
    );
    expect(agendaDisplayRoles(snapshot, "2027-01-01")[0].duties).toEqual([
      { role: "Morning conference host", displayName: "Assigned host" },
      { role: "Badge scanning", displayName: "Assigned scanner" },
      { role: "Door admission", displayName: "Assigned door" },
    ]);
    snapshot.staffingRoles[0].showOnAgenda = false;
    expect(agendaDisplayRoles(snapshot, "2027-01-01", true)).toEqual([]);
  });
});
