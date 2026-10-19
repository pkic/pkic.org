import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { agendaOccurrencePatchSchema, agendaRoomCreateSchema } from "../assets/shared/schemas/event-agenda";
import { agendaRoomOrderSchema } from "../assets/shared/schemas/event-agenda-room-order";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { agendaAuthoringFixture, agendaAuthoringEffects } from "./helpers/agenda-authoring";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
describe("owned agenda JSON containers and canonical room order", () => {
  it.each([null, { outside: "retained", agenda: null }])(
    "materializes legacy null containers and retains unrelated settings: %j",
    async (initial) => {
      const f = await agendaAuthoringFixture();
      await env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?")
        .bind(JSON.stringify(initial), f.eventId)
        .run();
      const agenda = await f.create({
        expectedRevision: 0,
        title: "Online session",
        startAt: null,
        endAt: null,
        roomId: null,
        virtualRoomUrl: "https://example.test/room",
      });
      const id = agenda.occurrences[0]!.id;
      expect(agenda.occurrences[0]!.virtualRoomUrl).toBe("https://example.test/room");
      expect(await f.settings()).toEqual({
        ...(initial ?? {}),
        agenda: { sessionMedia: { [id]: { joinUrl: "https://example.test/room" } } },
      });
      const cleared = await f.saved(
        await f.raw(
          `/occurrences/${id}`,
          agendaOccurrencePatchSchema.parse({ expectedRevision: agenda.revision, virtualRoomUrl: null }),
          "PATCH",
        ),
      );
      expect(cleared.occurrences[0]).not.toHaveProperty("virtualRoomUrl");
      expect(await f.settings()).toEqual({ ...(initial ?? {}), agenda: { sessionMedia: { [id]: {} } } });
    },
  );

  it("materializes order before a rename and persists an explicit permutation without changing room IDs", async () => {
    const f = await agendaAuthoringFixture();
    await env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?")
      .bind('{"outside":7,"agenda":null}', f.eventId)
      .run();
    const first = await f.saved(
      await f.raw("/rooms", agendaRoomCreateSchema.parse({ expectedRevision: 0, name: "Zeta", capacity: null })),
    );
    const second = await f.saved(
      await f.raw(
        "/rooms",
        agendaRoomCreateSchema.parse({ expectedRevision: first.revision, name: "Alpha", capacity: null }),
      ),
    );
    const ids = second.rooms.map((room) => room.id);
    expect(second.rooms.map((room) => room.name)).toEqual(["Zeta", "Alpha"]);
    const renamed = await f.saved(
      await f.raw(
        `/rooms/${ids[0]}`,
        agendaRoomCreateSchema.parse({ expectedRevision: second.revision, name: "Zulu renamed", capacity: null }),
        "PUT",
      ),
    );
    expect(renamed.rooms.map((room) => room.id)).toEqual(ids);
    const reordered = await f.saved(
      await f.raw(
        "/rooms/order",
        agendaRoomOrderSchema.parse({ expectedRevision: renamed.revision, roomIds: [...ids].reverse() }),
      ),
    );
    expect(reordered.rooms.map((room) => room.id)).toEqual([...ids].reverse());
    expect(await f.settings()).toEqual({ outside: 7, agenda: { roomOrder: [...ids].reverse() } });
    const before = await agendaAuthoringEffects();
    for (const body of [
      { expectedRevision: renamed.revision, roomIds: ids },
      { expectedRevision: reordered.revision, roomIds: [ids[0], crypto.randomUUID()] },
      { expectedRevision: reordered.revision, roomIds: [ids[0], ids[0]] },
    ]) {
      const response = await f.raw("/rooms/order", body);
      expect([400, 409]).toContain(response.status);
      expect(await agendaAuthoringEffects()).toEqual(before);
    }
  });

  it("rolls back room ordering after a concurrent settings write and keeps that competing write", async () => {
    const f = await agendaAuthoringFixture();
    const agenda = await f.saved(
      await f.raw("/rooms", agendaRoomCreateSchema.parse({ expectedRevision: 0, name: "Room", capacity: null })),
    );
    const before = await agendaAuthoringEffects();
    let raced = false;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("UPDATE events SET settings_json=json_set"),
      async () => {
        raced = true;
        await env.DB.prepare("UPDATE events SET settings_json=json_set(settings_json,'$.competing',1) WHERE id=?")
          .bind(f.eventId)
          .run();
      },
    );
    const response = await f.raw(
      "/rooms/order",
      agendaRoomOrderSchema.parse({ expectedRevision: agenda.revision, roomIds: agenda.rooms.map((room) => room.id) }),
      "POST",
      db,
    );
    expect(raced).toBe(true);
    expect(response.status).toBe(409);
    const { events: _eventsBefore, ...domainBefore } = before,
      { events: _eventsAfter, ...domainAfter } = await agendaAuthoringEffects();
    expect(domainAfter).toEqual(domainBefore);
    expect(await f.settings()).toMatchObject({ competing: 1 });
  });
});
