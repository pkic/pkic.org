import { describe, expect, it } from "vitest";
import { agendaOccurrenceSchema, type AgendaOccurrence } from "../../assets/shared/schemas/event-agenda";
import { agendaSessionPresentationTiming } from "../../assets/shared/event-agenda-transition";

const occurrence = (
  id: string,
  startAt: string,
  endAt: string,
  roomId = "blue",
  kind: AgendaOccurrence["kind"] = "session",
) => agendaOccurrenceSchema.parse({ id, title: id, description: "", startAt, endAt, roomId, kind, speakers: [] });
const start = "2026-12-01T09:00:00.000Z";
const boundary = "2026-12-01T09:30:00.000Z";
const end = "2026-12-01T10:00:00.000Z";
const talk = occurrence("talk", start, boundary);
const next = [occurrence("next-blue", boundary, end), occurrence("next-red", boundary, end, "red")];
const derive = (item = talk, following = next, minutes = 5) =>
  agendaSessionPresentationTiming(item, [item, ...following], "Europe/Amsterdam", minutes);

describe("derived presentation handover", () => {
  it("reserves five minutes before genuine parallel talks without changing the advertised slot", () => {
    const captured = structuredClone([talk, ...next]);
    expect(derive()).toEqual({ contentDurationMinutes: 25, transitionMinutes: 5 });
    expect(derive()).toEqual({ contentDurationMinutes: 25, transitionMinutes: 5 });
    expect([talk, ...next]).toEqual(captured);
    expect(talk.endAt).toBe(boundary);
  });
  it("does not subtract a second time from an existing imported handover gap", () => {
    expect(derive({ ...talk, endAt: "2026-12-01T09:25:00.000Z" })).toEqual({});
  });
  it.each(["Coffee break", "Lunch"])("keeps the full presentation before %s and never shortens the break", (title) => {
    const pause = { ...occurrence("pause", boundary, end, "blue", "break"), title };
    expect(derive(talk, [pause, ...next])).toEqual({});
    expect(derive({ ...talk, kind: "break", title })).toEqual({});
  });
  it("keeps end-of-day, unknown timing, and short slots intact", () => {
    expect(derive(talk, [])).toEqual({});
    expect(derive({ ...talk, startAt: null, endAt: null })).toEqual({});
    expect(derive({ ...talk, startAt: "2026-12-01T09:25:00.000Z" })).toEqual({});
    const midnight = "2026-12-01T23:00:00.000Z";
    expect(
      derive(occurrence("last", "2026-12-01T22:30:00.000Z", midnight), [
        occurrence("new-blue", midnight, "2026-12-01T23:30:00.000Z"),
        occurrence("new-red", midnight, "2026-12-01T23:30:00.000Z", "red"),
      ]),
    ).toEqual({});
  });
  it("does not treat one talk or a multi-room plenary as parallel choices", () => {
    expect(derive(talk, [next[0]!])).toEqual({});
    expect(derive(talk, [{ ...next[0]!, kind: "plenary", additionalRoomIds: ["red"] }])).toEqual({});
    expect(derive(talk, [next[0]!, { ...next[1]!, roomId: "blue" }])).toEqual({});
  });
  it("honors an explicit handover parameter without changing speaker travel policy", () => {
    expect(derive(talk, next, 10)).toEqual({ contentDurationMinutes: 20, transitionMinutes: 10 });
    expect(derive(talk, next, 0)).toEqual({});
  });
});
