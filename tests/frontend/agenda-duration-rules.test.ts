import { describe, expect, it } from "vitest";
import { agendaDurationRulesSchema } from "../../assets/shared/schemas/event-agenda-duration";
import {
  agendaSettingsSchema,
  agendaSnapshotSchema,
  agendaOccurrenceSchema,
} from "../../assets/shared/schemas/event-agenda";
import { readAgendaDurationRules } from "../../assets/shared/event-agenda-duration";
import { scheduleMove } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/schedule-proposals";

describe("event agenda duration rules", () => {
  it("retains legacy defaults and accepts old settings commands without changing duration rules", () => {
    expect(readAgendaDurationRules(null)).toEqual({ defaultMinutes: 30, quickMinutes: [15, 30, 45, 60] });
    expect(agendaSettingsSchema.parse({ expectedRevision: 4, travelMinutes: 5 }).durationRules).toBeUndefined();
  });
  it("round-trips the owned settings leaf without exposing unrelated configuration", () => {
    const rules = { defaultMinutes: 40, quickMinutes: [20, 40, 80] };
    expect(
      readAgendaDurationRules(JSON.stringify({ privateSetting: "not projected", agenda: { durationRules: rules } })),
    ).toEqual(rules);
    expect(
      agendaSettingsSchema.parse({ expectedRevision: 4, travelMinutes: 5, durationRules: rules }).durationRules,
    ).toEqual(rules);
  });
  it.each([
    { defaultMinutes: 0 },
    { defaultMinutes: 1441 },
    { defaultMinutes: 2.5 },
    { quickMinutes: [] },
    { quickMinutes: [15, 15] },
    { quickMinutes: [30, -1] },
  ])("rejects invalid rules %j", (rules) => {
    expect(agendaDurationRulesSchema.safeParse(rules).success).toBe(false);
  });
  it("uses the event default for a new placement while preserving an existing authored duration", () => {
    const snapshot = agendaSnapshotSchema.parse({
      eventSlug: "synthetic",
      timeZone: "UTC",
      revision: 4,
      publishedRevision: null,
      rooms: [],
      occurrences: [],
      shifts: [],
      roleMembers: [],
      assignments: [],
      durationRules: { defaultMinutes: 40, quickMinutes: [20, 40, 80] },
    });
    const session = agendaOccurrenceSchema.parse({
      id: "session",
      title: "Synthetic talk",
      startAt: null,
      endAt: null,
      roomId: null,
      speakers: [],
    });
    const startAt = "2026-12-01T09:00:00.000Z";
    expect(scheduleMove(snapshot, session, startAt, null).changes[0].endAt).toBe("2026-12-01T09:40:00.000Z");
    expect(
      scheduleMove(
        snapshot,
        { ...session, startAt: "2026-11-30T09:00:00.000Z", endAt: "2026-11-30T09:25:00.000Z" },
        startAt,
        null,
      ).changes[0].endAt,
    ).toBe("2026-12-01T09:25:00.000Z");
  });
});
