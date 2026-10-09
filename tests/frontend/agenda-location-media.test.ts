import { describe, expect, it } from "vitest";
import { agendaOccurrenceMedia, agendaOccurrenceRequiredEquipment } from "../../assets/shared/event-agenda-media";
import { withinAgendaEventWindow } from "../../assets/shared/event-agenda-event-window";
import { agendaSessionContent } from "../../assets/shared/public-agenda-content";
import {
  agendaOccurrencePatchSchema,
  agendaSnapshotSchema,
  type AgendaOccurrence,
} from "../../assets/shared/schemas/event-agenda";
import { publicAgendaProjection } from "../../functions/_lib/services/event-agenda/public-projection";

const roomLink = "https://meet.example.test/main";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "location-media",
  timeZone: "UTC",
  revision: 3,
  publishedRevision: 3,
  approvedAt: "2026-11-01T00:00:00.000Z",
  eventStartsAt: "2026-12-01T08:00:00.000Z",
  eventEndsAt: "2026-12-02T18:00:00.000Z",
  rooms: [
    {
      id: "main",
      name: "Main hall",
      capacity: 100,
      equipment: ["recording", "live_streaming"],
      virtualRoomUrl: roomLink,
    },
    { id: "side", name: "Side room", capacity: 20, equipment: ["projector"] },
  ],
  occurrences: [
    {
      id: "inherits",
      title: "Follows the main hall",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: "main",
      speakers: [],
    },
  ],
  shifts: [],
  roleMembers: [],
  assignments: [],
});
const inherits = snapshot.occurrences[0]!;
const variant = (patch: Partial<AgendaOccurrence>) => ({ ...inherits, ...patch });

describe("session media follow the primary location", () => {
  it("inherits planned media and the virtual-room link while the session has no plan", () => {
    expect(agendaOccurrenceMedia(snapshot.rooms, inherits)).toEqual({
      inherited: true,
      recording: true,
      liveStreaming: true,
      virtualRoomUrl: roomLink,
    });
    expect(agendaOccurrenceMedia(snapshot.rooms, variant({ roomId: "side" }))).toEqual({
      inherited: true,
      recording: false,
      liveStreaming: false,
      virtualRoomUrl: null,
    });
    expect(agendaOccurrenceMedia(snapshot.rooms, variant({ roomId: null })).virtualRoomUrl).toBeNull();
  });

  it("replaces all location media with an explicit plan, and keeps an own link authored before inheritance", () => {
    expect(
      agendaOccurrenceMedia(snapshot.rooms, variant({ plannedMedia: { recording: false, liveStreaming: false } })),
    ).toEqual({ inherited: false, recording: false, liveStreaming: false, virtualRoomUrl: null });
    expect(
      agendaOccurrenceMedia(snapshot.rooms, variant({ virtualRoomUrl: "https://meet.example.test/own" }))
        .virtualRoomUrl,
    ).toBe("https://meet.example.test/own");
  });

  it("checks only an explicit plan against the location's equipment", () => {
    expect(agendaOccurrenceRequiredEquipment(variant({ requiredEquipment: ["projector"] }))).toEqual(["projector"]);
    expect(
      agendaOccurrenceRequiredEquipment(
        variant({ requiredEquipment: ["projector"], plannedMedia: { recording: true, liveStreaming: false } }),
      ),
    ).toEqual(["projector", "recording"]);
  });

  it("projects the effective plan to session cards and never publishes either link", () => {
    const card = agendaSessionContent(snapshot, inherits);
    expect(card.plannedMedia).toEqual({ recording: true, liveStreaming: true });
    expect(card.onlineAccessUrl).toContain("session=inherits");
    expect(agendaSessionContent(snapshot, variant({ roomId: "side" })).onlineAccessUrl).toBeUndefined();
    const projected = publicAgendaProjection(snapshot, null);
    expect(projected.occurrences[0]!.onlineAccessAvailable).toBe(true);
    expect(JSON.stringify(projected)).not.toContain(roomLink);
    expect(agendaSessionContent(projected, projected.occurrences[0]!).plannedMedia).toEqual({
      recording: true,
      liveStreaming: true,
    });
  });
});

describe("event date bounds in the occurrence contract", () => {
  const schema = withinAgendaEventWindow(agendaOccurrencePatchSchema, snapshot);
  it("accepts times within the event and refuses each edge outside it", () => {
    const base = { expectedRevision: 3 };
    expect(
      schema.safeParse({ ...base, startAt: "2026-12-01T08:00:00.000Z", endAt: "2026-12-02T18:00:00.000Z" }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...base, startAt: null, endAt: null }).success).toBe(true);
    const outside = schema.safeParse({
      ...base,
      startAt: "2026-11-30T09:00:00.000Z",
      endAt: "2026-12-03T09:00:00.000Z",
    });
    expect(outside.success).toBe(false);
    expect(outside.error?.issues.map((issue) => issue.path.join("."))).toEqual(["startAt", "endAt"]);
  });
});
