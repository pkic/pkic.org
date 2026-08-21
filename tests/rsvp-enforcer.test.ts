import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordCalendarRsvpEvent } from "../functions/_lib/services/calendar-rsvp";
import { runRsvpEnforcer } from "../functions/_lib/services/rsvp-enforcer";
import {
  fetchAdminRegistrationWithDetails,
  toAdminRegistrationDetail,
} from "../functions/_lib/services/registrations/admin-detail";
import { listAdminEventRegistrations } from "../functions/_lib/services/registrations/admin-list";
import { listDueRsvpEnforcementCandidates } from "../functions/_lib/services/rsvp-enforcement/candidates";
import { buildRsvpDayAction, commitRsvpDayAction } from "../functions/_lib/services/rsvp-enforcement/day-action";
import type { Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import {
  RSVP_ENFORCEMENT_D1_SAFETY_MARGIN,
  RSVP_ENFORCEMENT_MAX_ACTION_STATEMENTS,
  RSVP_ENFORCEMENT_SELECTION_STATEMENTS,
} from "../assets/shared/constants/rsvp-enforcement";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

interface SeededRegistration {
  eventId: string;
  userId: string;
  registrationId: string;
  dayOneId: string;
  dayTwoId: string;
  dayOneDate: string;
  dayTwoDate: string;
}

function dateFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...(env as unknown as Env), APP_BASE_URL: "https://app.test", ...overrides } as Env;
}

async function seedTwoDayRegistration(): Promise<SeededRegistration> {
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const dayOneId = crypto.randomUUID();
  const dayTwoId = crypto.randomUUID();
  const dayOneDate = dateFromNow(20);
  const dayTwoDate = dateFromNow(21);
  const eventSlug = `rsvp-${eventId}`;
  const userEmail = `alice-${userId}@example.com`;
  const at = nowIso();
  const attendanceOptions = JSON.stringify([
    { value: "in_person", label: "In person", capacity: 10 },
    { value: "on_demand", label: "On demand", capacity: null },
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events
           (id, slug, name, timezone, starts_at, ends_at, source_path, capacity_in_person,
            registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
         VALUES (?, ?, 'RSVP Test', 'UTC', ?, ?, ?,
                 20, 'open', 5, '{}', ?, ?)`,
    ).bind(
      eventId,
      eventSlug,
      hoursFromNow(20 * 24),
      hoursFromNow(22 * 24),
      `content/events/${eventSlug}/_index.md`,
      at,
      at,
    ),
    env.DB.prepare(
      `INSERT INTO users
           (id, email, normalized_email, first_name, role, active, created_at, updated_at)
         VALUES (?, ?, ?, 'Alice', 'user', 1, ?, ?)`,
    ).bind(userId, userEmail, userEmail, at, at),
    env.DB.prepare(
      `INSERT INTO registrations
           (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
         VALUES (?, ?, ?, 'registered', 'in_person', 'direct', ?, ?, ?)`,
    ).bind(registrationId, eventId, userId, crypto.randomUUID(), at, at),
    env.DB.prepare(
      `INSERT INTO event_days
           (id, event_id, day_date, label, starts_at, ends_at, in_person_capacity,
            attendance_options_json, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'Day one', ?, ?, 10, ?, 1, ?, ?),
                (?, ?, ?, 'Day two', ?, ?, 10, ?, 2, ?, ?)`,
    ).bind(
      dayOneId,
      eventId,
      dayOneDate,
      hoursFromNow(20 * 24),
      hoursFromNow(20 * 24 + 8),
      attendanceOptions,
      at,
      at,
      dayTwoId,
      eventId,
      dayTwoDate,
      hoursFromNow(21 * 24),
      hoursFromNow(21 * 24 + 8),
      attendanceOptions,
      at,
      at,
    ),
    env.DB.prepare(
      `INSERT INTO registration_day_attendance
           (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
         VALUES (?, ?, ?, 'in_person', ?, ?), (?, ?, ?, 'in_person', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      registrationId,
      dayOneId,
      at,
      at,
      crypto.randomUUID(),
      registrationId,
      dayTwoId,
      at,
      at,
    ),
    env.DB.prepare(
      `INSERT INTO event_day_waitlist_entries
           (id, event_id, event_day_id, registration_id, user_id, priority_lane, status,
            position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'general', 'accepted', 1, ?, ?)`,
    ).bind(crypto.randomUUID(), eventId, dayOneId, registrationId, userId, at, at),
    env.DB.prepare(
      `INSERT INTO event_participants
           (id, event_id, user_id, role, subrole, status, source_type, source_ref, created_at, updated_at)
         VALUES (?, ?, ?, 'attendee', 'in_person', 'active', 'direct', NULL, ?, ?)`,
    ).bind(crypto.randomUUID(), eventId, userId, at, at),
  ]);
  return { eventId, userId, registrationId, dayOneId, dayTwoId, dayOneDate, dayTwoDate };
}

async function recordResponse(
  seeded: SeededRegistration,
  status: "accepted" | "declined" | "tentative" | "bounced",
  dayDate: string | null,
  receivedAt: string,
  sourceMessageId: string = crypto.randomUUID(),
): Promise<void> {
  await recordCalendarRsvpEvent(env.DB, {
    registrationId: seeded.registrationId,
    eventDayDate: dayDate,
    icsUid: dayDate ? `${seeded.registrationId}-${dayDate}@pkic.org` : `${seeded.registrationId}@pkic.org`,
    attendeeEmail: "alice@example.com",
    responseStatus: status,
    provider: "test-provider",
    sourceMessageId,
    receivedAt,
  });
}

async function makeRegistrationActionsDue(registrationId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE calendar_rsvp_events SET warning_sent_at = ?, action_due_at = ? WHERE registration_id = ?",
  )
    .bind(hoursFromNow(-49), hoursFromNow(-1), registrationId)
    .run();
}

async function makeSourceActionDue(sourceMessageId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE calendar_rsvp_events SET warning_sent_at = ?, action_due_at = ? WHERE source_message_id = ?",
  )
    .bind(hoursFromNow(-49), hoursFromNow(-1), sourceMessageId)
    .run();
}

describe("day-scoped RSVP enforcement", () => {
  beforeEach(resetDb);

  it("warns and later downgrades only the declined day atomically", async () => {
    const seeded = await seedTwoDayRegistration();
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-2));

    await expect(runRsvpEnforcer(env.DB, testEnv())).resolves.toMatchObject({ warningsSent: 1 });
    const [warning] = await queryAll<{ warning_sent_at: string; action_due_at: string }>(
      env.DB,
      "SELECT warning_sent_at, action_due_at FROM calendar_rsvp_events WHERE registration_id = ?",
      seeded.registrationId,
    );
    expect(Date.parse(warning.action_due_at)).toBeGreaterThan(Date.parse(warning.warning_sent_at));
    await makeRegistrationActionsDue(seeded.registrationId);
    await expect(runRsvpEnforcer(env.DB, testEnv())).resolves.toMatchObject({ downgradesProcessed: 1 });

    await expect(
      queryAll<{ event_day_id: string; attendance_type: string }>(
        env.DB,
        `SELECT event_day_id, attendance_type FROM registration_day_attendance
         WHERE registration_id = ? ORDER BY event_day_id`,
        seeded.registrationId,
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        { event_day_id: seeded.dayOneId, attendance_type: "on_demand" },
        { event_day_id: seeded.dayTwoId, attendance_type: "in_person" },
      ]),
    );
    await expect(
      queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = ?",
        seeded.registrationId,
        seeded.dayOneId,
      ),
    ).resolves.toEqual([{ status: "removed" }]);
    await expect(
      queryAll<{ status: string; attendance_type: string }>(
        env.DB,
        "SELECT status, attendance_type FROM registrations WHERE id = ?",
        seeded.registrationId,
      ),
    ).resolves.toEqual([{ status: "registered", attendance_type: "in_person" }]);
    await expect(
      queryAll<{ event_day_id: string; to_type: string }>(
        env.DB,
        "SELECT event_day_id, to_type FROM registration_attendance_history WHERE registration_id = ?",
        seeded.registrationId,
      ),
    ).resolves.toEqual([{ event_day_id: seeded.dayOneId, to_type: "on_demand" }]);
    await expect(
      queryAll<{ template_key: string }>(
        env.DB,
        "SELECT template_key FROM email_outbox WHERE recipient_user_id = ? ORDER BY created_at",
        seeded.userId,
      ),
    ).resolves.toEqual([{ template_key: "rsvp_warning" }, { template_key: "rsvp_downgraded" }]);
  });

  it("does not let an acceptance on another day suppress a decline", async () => {
    const seeded = await seedTwoDayRegistration();
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-3), "decline-day-one");
    await recordResponse(seeded, "accepted", seeded.dayTwoDate, hoursFromNow(-2), "accept-day-two");
    await expect(runRsvpEnforcer(env.DB, testEnv())).resolves.toMatchObject({ warningsSent: 1, ignored: 0 });
  });

  it("supersedes a decline only with a newer acceptance for the same day", async () => {
    const seeded = await seedTwoDayRegistration();
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-3), "decline-day-one");
    await recordResponse(seeded, "accepted", seeded.dayOneDate, hoursFromNow(-2), "accept-day-one");
    await expect(runRsvpEnforcer(env.DB, testEnv())).resolves.toMatchObject({ warningsSent: 0, ignored: 1 });
    await expect(
      queryAll<{ action_taken: string }>(
        env.DB,
        "SELECT action_taken FROM calendar_rsvp_events WHERE source_message_id = 'decline-day-one'",
      ),
    ).resolves.toEqual([{ action_taken: "ignored_newer_accept" }]);
  });

  it("resets warning and action state when a deduplicated provider message changes status", async () => {
    const seeded = await seedTwoDayRegistration();
    const sourceMessageId = "provider-status-correction";
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-3), sourceMessageId);
    await makeSourceActionDue(sourceMessageId);

    await recordResponse(seeded, "accepted", seeded.dayOneDate, hoursFromNow(-2), sourceMessageId);

    await expect(
      queryAll<{
        response_status: string;
        warning_sent_at: string | null;
        action_due_at: string | null;
        action_executed_at: string | null;
        action_taken: string | null;
      }>(
        env.DB,
        `SELECT response_status, warning_sent_at, action_due_at, action_executed_at, action_taken
         FROM calendar_rsvp_events WHERE source_message_id = ?`,
        sourceMessageId,
      ),
    ).resolves.toEqual([
      {
        response_status: "accepted",
        warning_sent_at: null,
        action_due_at: null,
        action_executed_at: null,
        action_taken: null,
      },
    ]);
  });

  it("fails closed when a legacy event-level UID is ambiguous", async () => {
    const seeded = await seedTwoDayRegistration();
    await recordResponse(seeded, "declined", null, hoursFromNow(-2));
    await expect(runRsvpEnforcer(env.DB, testEnv())).resolves.toMatchObject({ warningsSent: 0, ignored: 1 });
    await expect(
      queryAll<{ event_day_id: string | null; action_taken: string }>(
        env.DB,
        "SELECT event_day_id, action_taken FROM calendar_rsvp_events",
      ),
    ).resolves.toEqual([{ event_day_id: null, action_taken: "ignored_unresolved_day" }]);
    await expect(
      queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_type = 'calendar_rsvp_event' AND entity_id = (SELECT id FROM calendar_rsvp_events)",
      ),
    ).resolves.toEqual([{ action: "rsvp_candidate_ignored" }]);
  });

  it("records heuristic delivery bounces without releasing a seat", async () => {
    const seeded = await seedTwoDayRegistration();
    await recordResponse(seeded, "bounced", seeded.dayOneDate, hoursFromNow(-1));
    await expect(runRsvpEnforcer(env.DB, testEnv())).resolves.toMatchObject({ bouncesProcessed: 1 });
    await expect(
      queryAll<{ attendance_type: string }>(
        env.DB,
        "SELECT attendance_type FROM registration_day_attendance WHERE registration_id = ? AND event_day_id = ?",
        seeded.registrationId,
        seeded.dayOneId,
      ),
    ).resolves.toEqual([{ attendance_type: "in_person" }]);
  });

  it("removes only the declined day when no fallback is configured", async () => {
    const seeded = await seedTwoDayRegistration();
    await env.DB.prepare("UPDATE event_days SET attendance_options_json = ? WHERE id = ?")
      .bind(JSON.stringify([{ value: "in_person", label: "In person", capacity: 10 }]), seeded.dayOneId)
      .run();
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-3));
    await makeRegistrationActionsDue(seeded.registrationId);
    await expect(runRsvpEnforcer(env.DB, testEnv())).resolves.toMatchObject({ downgradesProcessed: 1 });
    await expect(
      queryAll<{ event_day_id: string }>(
        env.DB,
        "SELECT event_day_id FROM registration_day_attendance WHERE registration_id = ?",
        seeded.registrationId,
      ),
    ).resolves.toEqual([{ event_day_id: seeded.dayTwoId }]);
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM registrations WHERE id = ?", seeded.registrationId),
    ).resolves.toEqual([{ status: "registered" }]);
  });

  it("removes the final declined day without changing the registration-wide aggregate", async () => {
    const seeded = await seedTwoDayRegistration();
    await env.DB.prepare("DELETE FROM registration_day_attendance WHERE registration_id = ? AND event_day_id = ?")
      .bind(seeded.registrationId, seeded.dayTwoId)
      .run();
    await env.DB.prepare("UPDATE event_days SET attendance_options_json = ? WHERE id = ?")
      .bind(JSON.stringify([{ value: "in_person", label: "In person", capacity: 10 }]), seeded.dayOneId)
      .run();
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-3));
    await makeRegistrationActionsDue(seeded.registrationId);

    await expect(runRsvpEnforcer(env.DB, testEnv())).resolves.toMatchObject({ downgradesProcessed: 1 });
    await expect(
      queryAll<{ status: string; attendance_type: string; cancellation_reason_code: string | null }>(
        env.DB,
        "SELECT status, attendance_type, cancellation_reason_code FROM registrations WHERE id = ?",
        seeded.registrationId,
      ),
    ).resolves.toEqual([{ status: "registered", attendance_type: "in_person", cancellation_reason_code: null }]);
    await expect(
      queryAll<{ event_day_id: string }>(
        env.DB,
        "SELECT event_day_id FROM registration_day_attendance WHERE registration_id = ?",
        seeded.registrationId,
      ),
    ).resolves.toEqual([]);
  });

  it("does not apply a prepared action after the RSVP row changes to accepted", async () => {
    const seeded = await seedTwoDayRegistration();
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-3));
    await makeRegistrationActionsDue(seeded.registrationId);

    const candidate = (await listDueRsvpEnforcementCandidates(env.DB, 10)).find(
      (row) => row.response_status === "declined" && row.event_day_id === seeded.dayOneId,
    );
    expect(candidate).toBeDefined();
    const action = await buildRsvpDayAction(env.DB, candidate!);
    await env.DB.prepare("UPDATE calendar_rsvp_events SET response_status = 'accepted' WHERE id = ?")
      .bind(candidate!.id)
      .run();

    await expect(commitRsvpDayAction(env.DB, action.statements)).resolves.toBe(false);
    await expect(
      queryAll<{ attendance_type: string }>(
        env.DB,
        "SELECT attendance_type FROM registration_day_attendance WHERE registration_id = ? AND event_day_id = ?",
        seeded.registrationId,
        seeded.dayOneId,
      ),
    ).resolves.toEqual([{ attendance_type: "in_person" }]);
  });

  it("exposes latest RSVP state independently for each event day in admin detail", async () => {
    const seeded = await seedTwoDayRegistration();
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-4), "detail-day-one");
    await recordResponse(seeded, "accepted", seeded.dayTwoDate, hoursFromNow(-3), "detail-day-two");
    const row = await fetchAdminRegistrationWithDetails(env.DB, seeded.eventId, seeded.registrationId);
    expect(row).not.toBeNull();
    const detail = toAdminRegistrationDetail(row!);
    expect(detail.rsvpByDay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_day_id: seeded.dayOneId, status: "declined" }),
        expect.objectContaining({ event_day_id: seeded.dayTwoId, status: "accepted" }),
      ]),
    );
  });

  it("groups admin registration RSVP summaries by canonical event day", async () => {
    const seeded = await seedTwoDayRegistration();
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-4), "list-day-one");
    await recordResponse(seeded, "accepted", seeded.dayTwoDate, hoursFromNow(-3), "list-day-two");
    const listed = await listAdminEventRegistrations(env.DB, seeded.eventId, { limit: 10, offset: 0 });
    const registration = listed.registrations.find((item) => item.id === seeded.registrationId);
    expect(registration).toBeDefined();
    const rsvpByDay = JSON.parse(registration!.rsvp_events_json ?? "[]") as Array<{
      event_day_id: string;
      status: string;
    }>;
    expect(rsvpByDay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_day_id: seeded.dayOneId, status: "declined" }),
        expect.objectContaining({ event_day_id: seeded.dayTwoId, status: "accepted" }),
      ]),
    );
  });

  it("does not start an RSVP pass when the remaining D1 budget cannot fit its safety margin", async () => {
    const seeded = await seedTwoDayRegistration();
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-3));
    const insufficientBudget =
      RSVP_ENFORCEMENT_D1_SAFETY_MARGIN +
      RSVP_ENFORCEMENT_SELECTION_STATEMENTS +
      RSVP_ENFORCEMENT_MAX_ACTION_STATEMENTS -
      1;
    await expect(
      runRsvpEnforcer(env.DB, testEnv({ SCHEDULED_D1_QUERY_BUDGET: String(insufficientBudget) })),
    ).resolves.toMatchObject({ examined: 0, limitReached: false });
    await expect(
      queryAll(
        env.DB,
        "SELECT warning_sent_at FROM calendar_rsvp_events WHERE registration_id = ?",
        seeded.registrationId,
      ),
    ).resolves.toEqual([{ warning_sent_at: null }]);
  });

  it("fails closed when the target day has no canonical start time", async () => {
    const seeded = await seedTwoDayRegistration();
    await env.DB.prepare("UPDATE event_days SET starts_at = NULL WHERE id = ?").bind(seeded.dayOneId).run();
    await recordResponse(seeded, "declined", seeded.dayOneDate, hoursFromNow(-3));
    await makeRegistrationActionsDue(seeded.registrationId);
    await expect(runRsvpEnforcer(env.DB, testEnv())).resolves.toMatchObject({
      downgradesProcessed: 0,
      ignored: 1,
    });
    await expect(
      queryAll<{ attendance_type: string }>(
        env.DB,
        "SELECT attendance_type FROM registration_day_attendance WHERE registration_id = ? AND event_day_id = ?",
        seeded.registrationId,
        seeded.dayOneId,
      ),
    ).resolves.toEqual([{ attendance_type: "in_person" }]);
  });

  it("bounds each pass and drains concurrent retries exactly once", async () => {
    const first = await seedTwoDayRegistration();
    const second = await seedTwoDayRegistration();
    await recordResponse(first, "declined", first.dayOneDate, hoursFromNow(-3), "bounded-first");
    await recordResponse(second, "declined", second.dayOneDate, hoursFromNow(-2), "bounded-second");
    const limited = testEnv({ SCHEDULED_RSVP_ENFORCEMENT_LIMIT: "1" });
    await expect(runRsvpEnforcer(env.DB, limited)).resolves.toMatchObject({ examined: 1, limitReached: true });
    await expect(runRsvpEnforcer(env.DB, limited)).resolves.toMatchObject({ examined: 1 });

    await makeSourceActionDue("bounded-first");
    const outcomes = await Promise.all([runRsvpEnforcer(env.DB, limited), runRsvpEnforcer(env.DB, limited)]);
    expect(outcomes.reduce((total, result) => total + result.downgradesProcessed, 0)).toBe(1);
    await expect(
      queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM email_outbox WHERE idempotency_key = 'calendar_rsvp:action:' || (SELECT id FROM calendar_rsvp_events WHERE source_message_id = 'bounded-first')",
      ),
    ).resolves.toEqual([{ total: 1 }]);
  });
});
