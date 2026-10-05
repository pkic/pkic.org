import { grantAdministrator } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { setSessionDelegation } from "../functions/_lib/services/event-participation/invitations";
import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";
import type { DatabaseLike } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { sessionInvitationRequestSchema } from "../assets/shared/schemas/event-session-management";
import { sessionReviewRequestSchema } from "../assets/shared/schemas/route-contracts-session-participation";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

const eventId = crypto.randomUUID(),
  occurrenceId = crypto.randomUUID(),
  otherOccurrenceId = crypto.randomUUID(),
  adminId = crypto.randomUUID(),
  speakerId = crypto.randomUUID(),
  attendeeId = crypto.randomUUID(),
  otherPersonId = crypto.randomUUID(),
  unregisteredId = crypto.randomUUID();
const slug = "participation-management";
let adminToken: string, speakerToken: string, otherToken: string;
type Action = "approve" | "reject" | "add" | "invite";

async function command(
  action: Action,
  token: string,
  db: DatabaseLike = env.DB,
  targetId = attendeeId,
  id = occurrenceId,
) {
  const review = action === "approve" || action === "reject";
  return callApi(
    { ...env, DB: db },
    `/api/v1/events/${slug}/agenda/${id}/${review ? `participation/${targetId}` : "invitations"}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(
        review
          ? sessionReviewRequestSchema.parse({ decision: action })
          : sessionInvitationRequestSchema.parse({
              userId: targetId,
              attendanceMode: "physical",
              action,
              reasonCode: "speaker_invitation",
            }),
      ),
    },
  );
}

async function pending() {
  await setSessionParticipation(env.DB, eventId, occurrenceId, attendeeId, {
    action: "request",
    attendanceMode: "physical",
  });
}

async function row() {
  return env.DB.prepare(
    "SELECT id,status,approval_state,allocation_revision FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?",
  )
    .bind(occurrenceId, attendeeId)
    .first<{ id: string; status: string; approval_state: string; allocation_revision: number }>();
}

async function effects() {
  const queries = [
    "SELECT id,event_id,occurrence_id,user_id,status,approval_state,allocation_revision,attendance_mode,room_id,updated_at FROM agenda_session_participations ORDER BY id",
    "SELECT id,event_id,occurrence_id,user_id,invited_by,revoked_at,reply_sequence FROM agenda_session_invitations ORDER BY id",
    "SELECT id,actor_id,action,entity_type,entity_id,details_json,scope_type,scope_id FROM audit_log ORDER BY id",
    "SELECT id,event_id,occurrence_id,user_id,actor_id,action,reason_code FROM agenda_session_invitation_audit ORDER BY id",
    "SELECT event_id,occurrence_id,user_id,sequence,status,updated_at FROM agenda_calendar_entries ORDER BY event_id,occurrence_id,user_id",
    "SELECT event_id,requested_at FROM agenda_participation_jobs ORDER BY event_id",
    "SELECT id,recipient_user_id,template_key,idempotency_key,payload_json FROM email_outbox ORDER BY id",
  ];
  return Promise.all(queries.map(async (sql) => (await env.DB.prepare(sql).all()).results));
}

/** Guarded reads also use batches; inject races only once the final write is prepared. */
function raceAtCommand(mutation: () => Promise<unknown>): DatabaseLike {
  let commandPrepared = false;
  const raced = mutateBeforeNextBatch(env.DB, mutation);
  return {
    prepare(sql) {
      if (
        sql.startsWith("UPDATE agenda_session_participations AS pending") ||
        sql.startsWith("WITH actor AS") ||
        sql.startsWith("INSERT INTO agenda_session_invitations(")
      )
        commandPrepared = true;
      return env.DB.prepare(sql);
    },
    batch: (statements) => (commandPrepared ? raced : env.DB).batch(statements),
  };
}

beforeEach(async () => {
  await resetDb();
  const now = nowIso();
  for (const id of [adminId, speakerId, attendeeId, otherPersonId, unregisteredId]) {
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
      .bind(id, `${id}@example.test`, `${id}@example.test`)
      .run();
  }
  await grantAdministrator(env.DB, adminId);
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,?,?,'UTC','invite_or_open','{}',?,?)",
  )
    .bind(eventId, slug, "Participation management", now, now)
    .run();
  for (const id of [speakerId, attendeeId, otherPersonId]) {
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, id, crypto.randomUUID(), now, now)
      .run();
  }
  for (const [index, id] of [occurrenceId, otherOccurrenceId].entries()) {
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,capacity) VALUES(?,?,?,?,?,'approval',1)",
    )
      .bind(
        id,
        eventId,
        `Session ${index}`,
        new Date(Date.now() + (index * 2 + 1) * 3600000).toISOString(),
        new Date(Date.now() + (index * 2 + 2) * 3600000).toISOString(),
      )
      .run();
  }
  await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)")
    .bind(occurrenceId, speakerId)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
  )
    .bind(eventId, now)
    .run();
  const snapshot = await getAgenda(env.DB, eventId, slug);
  await env.DB.prepare(
    "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
  )
    .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), adminId, now)
    .run();
  await setSessionDelegation(env.DB, eventId, occurrenceId, adminId, { userId: speakerId, enabled: true });
  adminToken = await createAdminSession(env.DB, adminId, crypto.randomUUID());
  speakerToken = await createAdminSession(env.DB, speakerId, crypto.randomUUID());
  otherToken = await createAdminSession(env.DB, otherPersonId, crypto.randomUUID());
});

describe("Audited participant management for assigned sessions", () => {
  it.each(["approve", "reject"] as const)(
    "attributes organizer %s to the canonical actor in the state-change batch",
    async (action) => {
      await pending();
      const request = await row();
      const response = await command(action, adminToken);
      expect(response.status, await response.text()).toBe(200);
      expect(await row()).toMatchObject({
        status: action === "approve" ? "reserved" : "canceled",
        approval_state: action === "approve" ? "approved" : "declined",
      });
      const audit = await env.DB.prepare(
        "SELECT actor_id,entity_id,scope_type,scope_id,details_json FROM audit_log WHERE action=?",
      )
        .bind(`session_participation_${action === "approve" ? "approved" : "rejected"}`)
        .first<{ actor_id: string; entity_id: string; scope_type: string; scope_id: string; details_json: string }>();
      expect(audit).toMatchObject({
        actor_id: adminId,
        entity_id: request!.id,
        scope_type: "event",
        scope_id: eventId,
      });
      expect(JSON.parse(audit!.details_json)).toMatchObject({
        occurrenceId: { to: occurrenceId },
        userId: { to: attendeeId },
        decision: { to: action },
      });
      const before = await effects();
      expect((await command(action, adminToken)).status).toBe(409);
      expect(await effects()).toEqual(before);
    },
  );

  it("allows the assigned delegated speaker to add and invite without unrelated enrollment", async () => {
    expect((await command("add", speakerToken)).status).toBe(200);
    expect(await row()).toMatchObject({ status: "reserved", approval_state: "approved" });
    expect(
      await env.DB.prepare(
        "SELECT actor_id,action FROM agenda_session_invitation_audit WHERE user_id=? AND action='add'",
      )
        .bind(attendeeId)
        .first(),
    ).toMatchObject({ actor_id: speakerId, action: "add" });
    expect(
      await env.DB.prepare(
        "SELECT actor_id,entity_id FROM audit_log WHERE action='session_participation_added'",
      ).first(),
    ).toMatchObject({ actor_id: speakerId, entity_id: (await row())!.id });
    expect((await command("invite", speakerToken, env.DB, unregisteredId)).status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT actor_id,action FROM agenda_session_invitation_audit WHERE user_id=? AND action='invite'",
      )
        .bind(unregisteredId)
        .first(),
    ).toMatchObject({ actor_id: speakerId, action: "invite" });
    expect(
      await env.DB.prepare("SELECT status,approval_state FROM agenda_session_participations WHERE user_id=?")
        .bind(unregisteredId)
        .first(),
    ).toMatchObject({ status: "saved", approval_state: "invited" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM registrations WHERE user_id=?").bind(unregisteredId).first("n"),
    ).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM identities").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM members").first("n")).toBe(0);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM agenda_session_participations WHERE occurrence_id=?")
        .bind(otherOccurrenceId)
        .first("n"),
    ).toBe(0);
  });

  it("records delegated approval while preserving a full pool as approved and waitlisted", async () => {
    expect((await command("add", speakerToken, env.DB, otherPersonId)).status).toBe(200);
    await pending();
    expect((await command("approve", speakerToken)).status).toBe(200);
    expect(await row()).toMatchObject({ status: "waitlisted", approval_state: "approved" });
    expect(
      await env.DB.prepare("SELECT actor_id FROM audit_log WHERE action='session_participation_approved'").first(
        "actor_id",
      ),
    ).toBe(speakerId);
  });

  it("limits managed Add to approval override and waitlists a full pool without exceeding capacity", async () => {
    expect((await command("add", adminToken, env.DB, otherPersonId)).status).toBe(200);
    expect((await command("add", speakerToken)).status).toBe(200);
    expect(await row()).toMatchObject({ status: "waitlisted", approval_state: "approved" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM agenda_session_participations WHERE occurrence_id=? AND status='reserved'",
      )
        .bind(occurrenceId)
        .first("n"),
    ).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM agenda_session_invitation_audit WHERE occurrence_id=? AND action='add'",
      )
        .bind(occurrenceId)
        .first("n"),
    ).toBe(2);
    const before = await effects();
    expect((await command("add", speakerToken, env.DB, unregisteredId)).status).toBe(409);
    expect(await effects()).toEqual(before);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM registrations WHERE user_id=?").bind(unregisteredId).first("n"),
    ).toBe(0);
  });

  it("refuses managed Add for the wrong event-day mode without changing registration or effects", async () => {
    const now = nowIso(),
      dayId = crypto.randomUUID();
    const start = await env.DB.prepare("SELECT start_at FROM event_agenda_occurrences WHERE id=?")
      .bind(occurrenceId)
      .first<string>("start_at");
    await env.DB.prepare("INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,?,?,?)")
      .bind(dayId, eventId, start!.slice(0, 10), now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) SELECT ?,id,?,'virtual',?,? FROM registrations WHERE event_id=? AND user_id=?",
    )
      .bind(crypto.randomUUID(), dayId, now, now, eventId, attendeeId)
      .run();
    const before = await effects();
    expect((await command("add", speakerToken)).status).toBe(409);
    expect(await effects()).toEqual(before);
    expect(
      await env.DB.prepare("SELECT attendance_type FROM registration_day_attendance WHERE event_day_id=?")
        .bind(dayId)
        .first("attendance_type"),
    ).toBe("virtual");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id=? AND user_id=?")
        .bind(eventId, attendeeId)
        .first("n"),
    ).toBe(1);
  });

  it.each(["approve", "add", "invite"] as const)(
    "rejects wrong-owner and foreign-occurrence %s without effects",
    async (action) => {
      if (action === "approve") await pending();
      const before = await effects();
      expect((await command(action, otherToken)).status).toBe(403);
      expect((await command(action, speakerToken, env.DB, attendeeId, otherOccurrenceId)).status).toBe(403);
      expect(await effects()).toEqual(before);
    },
  );

  it("refuses a delegation without an assigned appearance and an occurrence from another event", async () => {
    await pending();
    const now = nowIso(),
      foreignEventId = crypto.randomUUID(),
      foreignOccurrenceId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO agenda_session_delegations(occurrence_id,user_id,created_by,created_at) VALUES(?,?,?,?)",
    )
      .bind(occurrenceId, otherPersonId, adminId, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,?,'Foreign event','UTC','invite_or_open','{}',?,?)",
    )
      .bind(foreignEventId, `foreign-${foreignEventId}`, now, now)
      .run();
    await env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title) VALUES(?,?,'Foreign session')")
      .bind(foreignOccurrenceId, foreignEventId)
      .run();
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)")
      .bind(foreignOccurrenceId, speakerId)
      .run();
    await env.DB.prepare(
      "INSERT INTO agenda_session_delegations(occurrence_id,user_id,created_by,created_at) VALUES(?,?,?,?)",
    )
      .bind(foreignOccurrenceId, speakerId, adminId, now)
      .run();
    const before = await effects();
    for (const action of ["approve", "add", "invite"] as const) {
      expect((await command(action, otherToken)).status).toBe(403);
      expect((await command(action, speakerToken, env.DB, attendeeId, foreignOccurrenceId)).status).toBe(403);
    }
    expect(await effects()).toEqual(before);
  });

  const revokedAuthority = [
    "revoked session",
    "expired session",
    "disabled owner",
    "revoked delegation",
    "removed speaker",
  ] as const;
  it.each(
    revokedAuthority.flatMap((cause) => (["approve", "add", "invite"] as const).map((action) => ({ cause, action }))),
  )("rolls back $action when $cause changes immediately before commit", async ({ cause, action }) => {
    if (action === "approve") await pending();
    const before = await effects();
    const racedDb = raceAtCommand(async () => {
      switch (cause) {
        case "revoked session":
          return env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), speakerId).run();
        case "expired session":
          return env.DB.prepare("UPDATE sessions SET expires_at=? WHERE user_id=?")
            .bind(new Date(Date.now() - 60000).toISOString(), speakerId)
            .run();
        case "disabled owner":
          return env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(speakerId).run();
        case "revoked delegation":
          return env.DB.prepare(
            "UPDATE agenda_session_delegations SET revoked_at=? WHERE occurrence_id=? AND user_id=?",
          )
            .bind(nowIso(), occurrenceId, speakerId)
            .run();
        case "removed speaker":
          return env.DB.prepare("DELETE FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?")
            .bind(occurrenceId, speakerId)
            .run();
      }
    });
    expect((await command(action, speakerToken, racedDb)).ok).toBe(false);
    expect(await effects()).toEqual(before);
  });

  it.each(["approve", "add"] as const)(
    "preserves eligibility and rolls back %s when event registration is canceled",
    async (action) => {
      if (action === "approve") await pending();
      const before = await effects();
      const racedDb = raceAtCommand(() =>
        env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=? AND user_id=?")
          .bind(eventId, attendeeId)
          .run(),
      );
      expect((await command(action, speakerToken, racedDb)).status).toBe(409);
      expect(await effects()).toEqual(before);
    },
  );

  it("rolls back review audit/calendar/work/outbox when the pending request changes", async () => {
    await pending();
    const before = await effects();
    const racedDb = raceAtCommand(() =>
      env.DB.prepare("UPDATE agenda_session_participations SET status='canceled' WHERE occurrence_id=? AND user_id=?")
        .bind(occurrenceId, attendeeId)
        .run(),
    );
    expect((await command("approve", speakerToken, racedDb)).status).toBe(409);
    const after = await effects();
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(await row()).toMatchObject({ status: "canceled", approval_state: "pending", allocation_revision: 0 });
  });

  it("rechecks organizer authority before review and preserves every dependent effect on loss", async () => {
    await pending();
    const before = await effects();
    const racedDb = raceAtCommand(() =>
      env.DB.prepare(
        `UPDATE user_roles SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE user_id=? AND role_id='role-admin'
            AND context_type IS NULL AND context_id IS NULL AND revoked_at IS NULL`,
      )
        .bind(adminId)
        .run(),
    );
    expect((await command("approve", adminToken, racedDb)).status).toBe(403);
    expect(await effects()).toEqual(before);
  });
});
