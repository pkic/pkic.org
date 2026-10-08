import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedLegacyOfflineGrant } from "./helpers/legacy-offline-grant";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import {
  assertPublicationCapacity,
  preparePublicationCapacityGuard,
} from "../functions/_lib/services/event-agenda/publication-capacity";
import { physicalOccupiedSql } from "../functions/_lib/services/event-participation/capacity-accounting";
let eventId: string, operatorId: string, occurrenceId: string, deviceId: string, userId: string;
async function occupied() {
  return (await env.DB.prepare(
    `WITH target AS(SELECT ? AS id) SELECT ${physicalOccupiedSql("target.id")} AS total FROM target`,
  )
    .bind(occurrenceId)
    .first<{ total: number }>())!.total;
}
describe("Scanner evidence never reserves registration capacity", () => {
  beforeEach(async () => {
    await resetDb();
    eventId = crypto.randomUUID();
    operatorId = crypto.randomUUID();
    occurrenceId = crypto.randomUUID();
    deviceId = crypto.randomUUID();
    userId = crypto.randomUUID();
    const now = new Date().toISOString();
    for (const id of [operatorId, userId])
      await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
        .bind(id, `${id}@example.test`, `${id}@example.test`)
        .run();
    await grantAdministrator(env.DB, operatorId);
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'offline-rights-test','Offline rights','UTC','invite_or_open','{}',?,?)",
    )
      .bind(eventId, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, userId, crypto.randomUUID(), now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,admission_policy,capacity) VALUES(?,?,'Session','preference',1)",
    )
      .bind(occurrenceId, eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(eventId, now)
      .run();
    const snapshot = await getAgenda(env.DB, eventId, "offline-rights-test");
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), operatorId, now)
      .run();
  });
  it("allows publication and time changes with open or revoked scanner grants", async () => {
    const rights = await seedLegacyOfflineGrant({ eventId, occurrenceId, operatorId, deviceId });
    const snapshot = await getAgenda(env.DB, eventId, "offline-rights-test");
    await assertPublicationCapacity(env.DB, snapshot);
    const moved = {
      ...snapshot,
      occurrences: snapshot.occurrences.map((item) => ({
        ...item,
        startAt: "2030-01-01T10:00:00.000Z",
        endAt: "2030-01-01T11:00:00.000Z",
      })),
    };
    await assertPublicationCapacity(env.DB, moved);
    await env.DB.batch([preparePublicationCapacityGuard(env.DB, moved)]);
    await env.DB.prepare("UPDATE event_offline_admission_grants SET revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), rights.id)
      .run();
    await assertPublicationCapacity(env.DB, moved);
    expect(await occupied()).toBe(0);
    await assertPublicationCapacity(env.DB, moved);
    // A real session reservation continues to enforce the configured capacity.
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'physical','reserved',?,?)",
    )
      .bind(crypto.randomUUID(), eventId, occurrenceId, userId, new Date().toISOString(), new Date().toISOString())
      .run();
    expect(await occupied()).toBe(1);
    const tooSmall = { ...moved, occurrences: moved.occurrences.map((item) => ({ ...item, capacity: 0 })) };
    await expect(assertPublicationCapacity(env.DB, tooSmall)).rejects.toMatchObject({
      code: "AGENDA_RESERVED_CAPACITY",
    });
    await expect(env.DB.batch([preparePublicationCapacityGuard(env.DB, tooSmall)])).rejects.toThrow();
  });
});
