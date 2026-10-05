import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { seedEventAndAdmin, queryAll } from "./context";
import { hashBadgeCredential } from "../../functions/_lib/services/event-participation/scanning";
import { getAgenda } from "../../functions/_lib/services/event-agenda/read";
import { scannerDeviceSessionEnrollmentResponseSchema } from "../../assets/shared/schemas/event-scanner-devices";
import { callApi } from "./app";
import { createAdminSession } from "./auth";

/** One dated canonical fixture for both legacy and controlled local workloads. */
export async function createScannerLoadFixture(population: number, mode: "service" | "mounted", deviceCount = 32) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const [operator] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
  const observedAt = new Date().toISOString();
  const dayId = crypto.randomUUID();
  const day = observedAt.slice(0, 10);
  const expiresAt = new Date(Date.parse(observedAt) + 24 * 60 * 60 * 1000).toISOString();
  // Provision the actual dated entrance before filling its confirmed capacity.
  // The generic workflow fixture deliberately has only one physical place.
  await env.DB.prepare("UPDATE events SET timezone='UTC',starts_at=?,ends_at=?,capacity_in_person=? WHERE id=?")
    .bind(`${day}T00:00:00.000Z`, expiresAt, population, eventId)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_days(id,event_id,day_date,label,in_person_capacity,sort_order,created_at,updated_at) VALUES(?,?,?,'Arrival day',?,0,?,?)",
  )
    .bind(dayId, eventId, day, population, observedAt, observedAt)
    .run();
  const occurrenceId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,capacity) VALUES(?,?,'Published reservation session',?,?,'reservation',1)",
  )
    .bind(occurrenceId, eventId, observedAt, expiresAt)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
  )
    .bind(eventId, observedAt)
    .run();
  const snapshot = await getAgenda(env.DB, eventId, "pqc-2026");
  expect(snapshot.occurrences).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: occurrenceId, admissionPolicy: "reservation", capacity: 1 }),
    ]),
  );
  await env.DB.prepare(
    "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
  )
    .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), operator.id, observedAt)
    .run();
  const attendees = await Promise.all(
    Array.from({ length: population }, async () => {
      const userId = crypto.randomUUID();
      const credential = crypto.randomUUID();
      return {
        userId,
        credential,
        hash: await hashBadgeCredential(credential),
        badgeId: crypto.randomUUID(),
        registrationId: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
      };
    }),
  );
  for (let offset = 0; offset < attendees.length; offset += 100) {
    const json = JSON.stringify(attendees.slice(offset, offset + 100));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) SELECT json_extract(value,'$.userId'),json_extract(value,'$.userId')||'@example.test',json_extract(value,'$.userId')||'@example.test',1,?,? FROM json_each(?)",
      ).bind(observedAt, observedAt, json),
      env.DB.prepare(
        "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) SELECT json_extract(value,'$.registrationId'),?,json_extract(value,'$.userId'),'registered','in_person','synthetic',json_extract(value,'$.registrationId'),?,? FROM json_each(?)",
      ).bind(eventId, observedAt, observedAt, json),
      env.DB.prepare(
        "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) SELECT lower(hex(randomblob(16))),json_extract(value,'$.registrationId'),?,'in_person',?,? FROM json_each(?)",
      ).bind(dayId, observedAt, observedAt, json),
      env.DB.prepare(
        "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at,expires_at) SELECT json_extract(value,'$.badgeId'),?,json_extract(value,'$.userId'),json_extract(value,'$.hash'),?,? FROM json_each(?)",
      ).bind(eventId, observedAt, expiresAt, json),
    ]);
  }
  const devices = Array.from({ length: deviceCount }, () => crypto.randomUUID());
  const token = mode === "mounted" ? await createAdminSession(env.DB, operator.id, crypto.randomUUID()) : null;
  const epochs = new Map<string, { epochId: string; sequence: number }>();
  if (token) {
    for (const deviceId of devices) {
      const response = await callApi(env, "/api/v1/events/pqc-2026/scanner/devices/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ operationId: crypto.randomUUID(), deviceId }),
      });
      expect(response.status).toBe(200);
      const enrolled = scannerDeviceSessionEnrollmentResponseSchema.parse(await response.json());
      expect(enrolled).toMatchObject({ eventId, operatorUserId: operator.id, deviceId });
      epochs.set(deviceId, { epochId: enrolled.epochId, sequence: 0 });
    }
  }
  return { eventId, operator, observedAt, occurrenceId, attendees, devices, token, epochs };
}

/** Supporting scans must not mutate booking, approval, notification, or allocation state. */
export async function scannerLoadProtectedState() {
  const tables = [
    "registrations",
    "registration_day_attendance",
    "agenda_session_participations",
    "agenda_session_holds",
    "event_entry_admissions",
    "event_session_admissions",
    "event_offline_admission_spends",
    "email_outbox",
    "agenda_push_outbox",
    "audit_log",
    "agenda_participation_jobs",
  ];
  return {
    rows: await Promise.all(tables.map((table) => queryAll(env.DB, `SELECT * FROM ${table} ORDER BY rowid`))),
    capacity: await queryAll(env.DB, "SELECT id,capacity_in_person FROM events ORDER BY id"),
    sessionCapacity: await queryAll(
      env.DB,
      "SELECT id,capacity,remote_capacity FROM event_agenda_occurrences ORDER BY id",
    ),
  };
}
