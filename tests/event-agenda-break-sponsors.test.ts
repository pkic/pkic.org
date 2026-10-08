import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { agendaBreaksCreateSchema } from "../assets/shared/schemas/event-agenda-breaks";
import { agendaSponsorChoicesResponseSchema } from "../assets/shared/schemas/event-agenda-sponsors";
import { agendaRoomCreateSchema, agendaRevisionSchema } from "../assets/shared/schemas/event-agenda";
import { publicAgendaProjection } from "../functions/_lib/services/event-agenda/public-projection";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { agendaAuthoringFixture, agendaAuthoringEffects } from "./helpers/agenda-authoring";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
const intervals = [
  { startAt: "2026-12-01T11:00:00.000Z", endAt: "2026-12-01T11:30:00.000Z" },
  { startAt: "2026-12-02T11:00:00.000Z", endAt: "2026-12-02T11:30:00.000Z" },
];
async function sponsor(eventId: string) {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,non_member_website,non_member_logo_r2_key,tier,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'Break Sponsor','https://example.test/sponsor','logos/synthetic.png','Ambassador','active',?,?)",
  )
    .bind(id, eventId, now, now)
    .run();
  return id;
}
describe("manual multi-day breaks with existing public event sponsorship", () => {
  it("creates one global break per selected day in one revision and captures only approved public branding", async () => {
    const f = await agendaAuthoringFixture(),
      sponsorId = await sponsor(f.eventId);
    await env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?")
      .bind('{"outside":9,"agenda":null}', f.eventId)
      .run();
    const choices = await f.raw("/sponsors");
    expect(choices.status).toBe(200);
    expect(
      agendaSponsorChoicesResponseSchema.parse(await choices.json()).sponsors.map((item) => item.sponsorId),
    ).toEqual([sponsorId]);
    const body = agendaBreaksCreateSchema.parse({
      expectedRevision: 0,
      title: "Coffee break",
      roomIds: null,
      intervals,
      sponsorIds: [sponsorId],
    });
    const saved = await f.saved(await f.raw("/breaks", body));
    expect(saved.revision).toBe(1);
    expect(saved.occurrences).toHaveLength(2);
    expect(new Set(saved.occurrences.map((item) => item.id)).size).toBe(2);
    for (const item of saved.occurrences) {
      expect(item).toMatchObject({
        kind: "break",
        roomId: null,
        additionalRoomIds: [],
        sponsorIds: [sponsorId],
        sponsors: [
          {
            id: sponsorId,
            name: "Break Sponsor",
            website: "https://example.test/sponsor",
            logoUrl: `/api/v1/sponsors/${sponsorId}/logo`,
          },
        ],
      });
      expect(item.speakers).toEqual([]);
    }
    expect(await f.settings()).toMatchObject({
      outside: 9,
      agenda: {
        sessionSponsors: Object.fromEntries(saved.occurrences.map((item) => [item.id, { sponsorIds: [sponsorId] }])),
      },
    });
    const beforeReplay = await agendaAuthoringEffects();
    expect((await f.raw("/breaks", body)).status).toBe(409);
    expect(await agendaAuthoringEffects()).toEqual(beforeReplay);
    const approved = await f.saved(
      await f.raw("/publications", agendaRevisionSchema.parse({ expectedRevision: saved.revision })),
    );
    const publicProjection = publicAgendaProjection(approved, null);
    for (const item of publicProjection.occurrences) {
      expect(item.sponsorIds).toBeUndefined();
      expect(item.sponsors?.[0]?.name).toBe("Break Sponsor");
    }
  });

  it("keeps explicit room subsets as one occurrence per day and rejects foreign scope with no partial inserts", async () => {
    const f = await agendaAuthoringFixture();
    const first = await f.saved(
      await f.raw("/rooms", agendaRoomCreateSchema.parse({ expectedRevision: 0, name: "One", capacity: null })),
    );
    const second = await f.saved(
      await f.raw(
        "/rooms",
        agendaRoomCreateSchema.parse({ expectedRevision: first.revision, name: "Two", capacity: null }),
      ),
    );
    const ids = second.rooms.map((item) => item.id);
    const saved = await f.saved(
      await f.raw(
        "/breaks",
        agendaBreaksCreateSchema.parse({ expectedRevision: second.revision, title: "Lunch", roomIds: ids, intervals }),
      ),
    );
    expect(saved.occurrences).toHaveLength(2);
    for (const item of saved.occurrences) expect([item.roomId, ...item.additionalRoomIds!]).toEqual(ids);
    const before = await agendaAuthoringEffects();
    const refused = await f.raw(
      "/breaks",
      agendaBreaksCreateSchema.parse({
        expectedRevision: saved.revision,
        title: "Foreign room",
        roomIds: [crypto.randomUUID()],
        intervals,
      }),
    );
    expect(refused.status).toBe(422);
    expect(await agendaAuthoringEffects()).toEqual(before);
  });

  it("rolls back every day on a settings CAS race and refuses approval after a sponsor changes during its final batch", async () => {
    const f = await agendaAuthoringFixture(),
      sponsorId = await sponsor(f.eventId),
      before = await agendaAuthoringEffects();
    let raced = false;
    const changedSettings = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("UPDATE events SET settings_json=json_set"),
      async () => {
        raced = true;
        await env.DB.prepare("UPDATE events SET settings_json=json_set(settings_json,'$.competing',1) WHERE id=?")
          .bind(f.eventId)
          .run();
      },
    );
    const body = agendaBreaksCreateSchema.parse({
      expectedRevision: 0,
      title: "Break",
      roomIds: null,
      intervals,
      sponsorIds: [sponsorId],
    });
    const refused = await f.raw("/breaks", body, "POST", changedSettings);
    expect(raced).toBe(true);
    expect(refused.status).toBe(409);
    const { events: _beforeEvents, ...beforeDomain } = before,
      { events: _afterEvents, ...afterDomain } = await agendaAuthoringEffects();
    expect(afterDomain).toEqual(beforeDomain);
    expect(await f.settings()).toMatchObject({ competing: 1 });
    const saved = await f.saved(await f.raw("/breaks", body));
    const beforeApproval = await agendaAuthoringEffects();
    let sponsorRaced = false;
    const changedSponsor = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("INSERT INTO event_agenda_publications"),
      async () => {
        sponsorRaced = true;
        await env.DB.prepare("UPDATE sponsorships SET non_member_name='Concurrent branding' WHERE id=?")
          .bind(sponsorId)
          .run();
      },
    );
    const refusedApproval = await f.raw(
      "/publications",
      agendaRevisionSchema.parse({ expectedRevision: saved.revision }),
      "POST",
      changedSponsor,
    );
    expect(sponsorRaced).toBe(true);
    expect(refusedApproval.status).toBe(409);
    expect(await agendaAuthoringEffects()).toEqual(beforeApproval);
  });
});
