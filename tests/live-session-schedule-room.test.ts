import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import { storedAgendaSnapshotSchema } from "../assets/shared/schemas/event-agenda-stored";
import { DEFAULT_LIVE_SCHEDULE_CONFIG } from "../assets/shared/schemas/live-session-schedule";
import { createLiveRoomFixture } from "./helpers/live-session-room";
const fixture = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof fixture.connect>>;
let clients: Client[] = [];
beforeEach(() => fixture.setup());
afterEach(() => {
  for (const client of clients) client.socket.close();
  clients = [];
});
async function connect(person: "operator" | "attendee") {
  const client = await fixture.connect({ person });
  clients.push(client);
  return client;
}
async function schedule() {
  const row = await env.DB.prepare(
    "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=1",
  )
    .bind(fixture.eventId)
    .first<{ snapshot_json: string }>();
  if (!row) throw new Error("Missing approved schedule fixture");
  const agenda = storedAgendaSnapshotSchema.parse(JSON.parse(row.snapshot_json));
  const current = agenda.occurrences[0]!;
  if (!current.endAt) throw new Error("Missing current end");
  const secondId = crypto.randomUUID();
  agenda.rooms.push({ ...agenda.rooms[0]!, id: secondId, name: "Blue room" });
  const late = {
    ...current,
    id: crypto.randomUUID(),
    title: "Later in this room",
    startAt: new Date(Date.parse(current.endAt) + 300000).toISOString(),
    endAt: new Date(Date.parse(current.endAt) + 1800000).toISOString(),
  };
  const early = {
    ...current,
    id: crypto.randomUUID(),
    roomId: secondId,
    title: "Earlier in the blue room",
    startAt: new Date(Date.now() + 600000).toISOString(),
    // It runs until after this room's next session starts, so both are in the next block.
    endAt: late.endAt,
  };
  agenda.occurrences.push(late, early);
  async function save() {
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=1")
      .bind(JSON.stringify(agenda), fixture.eventId)
      .run();
  }
  await save();
  return { agenda, late, early, save };
}
it("publishes independent room times, preserves the shot on refusal, and retains it across reconnect", async () => {
  const basis = await schedule();
  const operator = await connect("operator");
  const attendee = await connect("attendee");
  operator.send({ type: "stage.schedule", schedule: DEFAULT_LIVE_SCHEDULE_CONFIG });
  const stage = (await operator.next("stage.changed", (message) => message.stage.schedule !== null)).stage;
  expect(stage.schedule?.rooms.map((room) => room.startAt)).toEqual([basis.late.startAt, basis.early.startAt]);
  expect(stage.schedule?.rooms.map((room) => room.title)).toEqual([basis.late.title, basis.early.title]);
  attendee.send({ type: "stage.schedule", schedule: null });
  expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
  operator.send({
    type: "stage.set",
    questionId: null,
    creditKey: "missing-credit",
    timerGraphics: [],
    pollId: null,
    pollPresentation: { chart: "bar" },
    ticker: null,
    panelists: null,
    schedule: { scope: "all-rooms", layout: "list" },
    checkIn: null,
  });
  expect((await operator.next("room.refused")).code).toBe("LIVE_CREDIT_NOT_FOUND");
  const reconnect = await connect("operator");
  expect((await reconnect.next("room.snapshot")).stage.schedule).toEqual(stage.schedule);
});
it("refreshes approved schedule content without commands, stays quiet when unchanged, and clears explicitly", async () => {
  const basis = await schedule();
  const operator = await connect("operator");
  operator.send({ type: "stage.schedule", schedule: DEFAULT_LIVE_SCHEDULE_CONFIG });
  await operator.next("stage.changed", (message) => message.stage.schedule !== null);
  basis.late.title = "Revised approved title";
  await basis.save();
  await runDurableObjectAlarm(fixture.room());
  await runDurableObjectAlarm(fixture.room());
  await operator.next("stage.changed", (message) => message.stage.schedule?.rooms[0]?.title === basis.late.title);
  const count = operator.received.filter((message) => message.type === "stage.changed").length;
  await runDurableObjectAlarm(fixture.room());
  expect(operator.received.filter((message) => message.type === "stage.changed")).toHaveLength(count);
  operator.send({ type: "stage.schedule", schedule: null });
  expect(
    (await operator.next("stage.changed", (message) => message.stage.schedule === null)).stage.schedule,
  ).toBeNull();
});
