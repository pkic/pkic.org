import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import {
  agendaContentPlacementSchema,
  agendaContentPlacementResponseSchema,
} from "../assets/shared/schemas/event-agenda-content";
const eventId = crypto.randomUUID(),
  actor = crypto.randomUUID(),
  sourceId = crypto.randomUUID();
let token = "";
const endpoint = `/api/v1/events/legacy-placements/agenda/occurrences/${sourceId}/placements`;
async function place(expectedRevision: number, copyAsNew = false) {
  return callApi(env, endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(agendaContentPlacementSchema.parse({ expectedRevision, copyAsNew })),
  });
}
beforeEach(async () => {
  await resetDb();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
    .bind(actor, "placement@example.test", "placement@example.test")
    .run();
  await grantAdministrator(env.DB, actor);
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,'legacy-placements','Legacy','UTC','{}',?,?)",
  )
    .bind(eventId, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrences(id,event_id,title,description,kind,source_key,start_at,end_at,admission_policy,access_policy,capacity,remote_capacity,visibility,presentation_url,recording_url) VALUES(?,?,'Legacy panel','Original abstract','session','historical:panel','2027-01-01T10:00:00.000Z','2027-01-01T11:00:00.000Z','reservation','invitation',20,50,'public','https://example.test/slides','https://example.test/recording')",
  )
    .bind(sourceId, eventId)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode) VALUES(?,?,'moderator','remote')",
  )
    .bind(sourceId, actor)
    .run();
  token = await createAdminSession(env.DB, actor, "legacy-placement-session");
});
describe("mounted session occurrence placements", () => {
  it.each([false, true])(
    "atomically places legacy content with copyAsNew=%s and resets commitments",
    async (copyAsNew) => {
      const response = await place(0, copyAsNew);
      expect(response.status).toBe(200);
      const result = agendaContentPlacementResponseSchema.parse(await response.json());
      const original = result.agenda.occurrences.find((row) => row.id === sourceId)!;
      const repeated = result.agenda.occurrences.find((row) => row.id === result.occurrenceId)!;
      expect(original).toMatchObject({
        contentId: copyAsNew ? null : result.contentId,
        startAt: "2027-01-01T10:00:00.000Z",
        admissionPolicy: "reservation",
        accessPolicy: "invitation",
        capacity: 20,
        visibility: "public",
        speakers: [expect.objectContaining({ role: "moderator", attendanceMode: "remote" })],
      });
      expect(repeated).toMatchObject({
        contentId: result.contentId,
        title: "Legacy panel",
        description: "Original abstract",
        startAt: null,
        endAt: null,
        roomId: null,
        capacity: null,
        remoteCapacity: null,
        visibility: "private",
        admissionPolicy: "preference",
        accessPolicy: "open",
        presentationUrl: null,
        recordingUrl: null,
        speakers: [
          expect.objectContaining({ userId: actor, role: "moderator", attendanceMode: "physical", roomId: null }),
        ],
      });
      expect(
        await env.DB.prepare("SELECT source_key FROM event_agenda_contents WHERE id=?")
          .bind(result.contentId)
          .first("source_key"),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT source_key FROM event_agenda_occurrences WHERE id=?")
          .bind(result.occurrenceId)
          .first("source_key"),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM agenda_session_participations WHERE occurrence_id=?")
          .bind(result.occurrenceId)
          .first("count"),
      ).toBe(0);
      if (!copyAsNew) {
        const second = await place(result.agenda.revision);
        expect(second.status).toBe(200);
        const next = agendaContentPlacementResponseSchema.parse(await second.json());
        expect(next.contentId).toBe(result.contentId);
        expect(next.occurrenceId).not.toBe(result.occurrenceId);
        expect(
          await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_contents WHERE event_id=?")
            .bind(eventId)
            .first("count"),
        ).toBe(1);
      }
    },
  );
  it("rolls back legacy linking and content creation on a stale revision", async () => {
    expect((await place(1)).status).toBe(409);
    expect(
      await env.DB.prepare("SELECT content_id FROM event_agenda_occurrences WHERE id=?")
        .bind(sourceId)
        .first("content_id"),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_contents WHERE event_id=?")
        .bind(eventId)
        .first("count"),
    ).toBe(0);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_occurrences WHERE event_id=?")
        .bind(eventId)
        .first("count"),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='agenda.revision.updated'").first(
        "count",
      ),
    ).toBe(0);
  });
  it("requires authentication and canonical request validation", async () => {
    expect(
      (
        await callApi(env, endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision: 0 }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await callApi(env, endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision: -1 }),
        })
      ).status,
    ).toBe(400);
  });
});
