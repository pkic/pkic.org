import { grantAdministrator } from "./administrator";
import { env } from "cloudflare:workers";
import { resetDb } from "./reset-db";
import { callApi } from "./app";
import { createAdminSession } from "./auth";
import { issueBadge } from "../../functions/_lib/services/event-participation/scanning";
import { getAgenda } from "../../functions/_lib/services/event-agenda/read";
import { enrollScannerDevice } from "../../functions/_lib/services/event-participation/scanner-device-sessions";
/** Synthetic published session and recognized attendee shared by scan protocol tests. */
export function createEventScannerFixture() {
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const operatorId = crypto.randomUUID();
  const occurrenceId = crypto.randomUUID();
  let token: string;
  let badgeId: string;
  const deviceId = crypto.randomUUID();
  let epochId: string;
  let sequence = 0;
  const observedAt = "2026-10-03T10:00:00.000Z";
  function scanBody(overrides: Record<string, unknown> = {}) {
    return {
      operatorUserId: operatorId,
      operationId: crypto.randomUUID(),
      deviceId,
      scannerSession: { epochId, sequence: ++sequence },
      badgeId,
      occurrenceId,
      action: "attendance",
      observedAt,
      ...overrides,
    };
  }
  function scan(body: unknown, authenticated = true) {
    return callApi(env, "/api/v1/events/scan-test/scans", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  }
  async function setup() {
    await resetDb();
    const now = new Date().toISOString();
    for (const id of [userId, operatorId])
      await env.DB.prepare("INSERT INTO users (id,email,normalized_email,active) VALUES (?,?,?,1)")
        .bind(id, `${id}@example.test`, `${id}@example.test`)
        .run();
    await grantAdministrator(env.DB, operatorId);
    await env.DB.prepare(
      "INSERT INTO events (id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES (?,'scan-test','Scan test','UTC','invite_or_open','{}',?,?)",
    )
      .bind(eventId, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO registrations (id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES (?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, userId, crypto.randomUUID(), now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences (id,event_id,title,admission_policy,capacity) VALUES (?,?,'Limited session','reservation',1)",
    )
      .bind(occurrenceId, eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(eventId, now)
      .run();
    const snapshot = await getAgenda(env.DB, eventId, "scan-test");
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), operatorId, now)
      .run();
    badgeId = (await issueBadge(env.DB, eventId, operatorId, { userId, operationId: crypto.randomUUID() })).credential!;
    token = await createAdminSession(env.DB, operatorId, crypto.randomUUID());
    epochId = (await enrollScannerDevice(env.DB, eventId, operatorId, { operationId: crypto.randomUUID(), deviceId }))
      .epochId;
    sequence = 0;
  }
  return {
    eventId,
    userId,
    operatorId,
    occurrenceId,
    observedAt,
    scanBody,
    scan,
    setup,
    get badgeId() {
      return badgeId;
    },
    get epochId() {
      return epochId;
    },
    deviceId,
    get token() {
      return token;
    },
  };
}
