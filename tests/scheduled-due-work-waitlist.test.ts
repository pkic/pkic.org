import { beforeEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { getEventBySlug } from "../functions/_lib/services/events";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import {
  createRegistration,
  confirmRegistrationByToken,
  updateRegistrationByManageToken,
} from "../functions/_lib/services/registrations";
import { runWaitlistPromotionCycle } from "../functions/_lib/services/registrations/waitlist-promotions";
import { runScheduledDueWork } from "../functions/_lib/services/scheduled-due-work";
import type { Env } from "../functions/_lib/types";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import { z } from "zod";
import { outboxIdForOperation } from "../functions/_lib/email/outbox-queue";
import { emailOutboxResponseSchema } from "../assets/shared/schemas/email-outbox";
import { ADMINISTRATOR_FIXTURE_USER_SQL } from "./helpers/administrator";
import app from "./helpers/app";
import { createAdminSession } from "./helpers/auth";

const baseEnv = workerEnv as unknown as Env;

describe("scheduled due work waitlist promotions", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("honors the registry's invocation-wide deadline before starting a pass", async () => {
    const result = await runScheduledDueWork(
      { ...baseEnv, APP_BASE_URL: "https://app.test", SCHEDULED_DUE_WORK_MAX_MS: "120000" },
      { deadlineAt: Date.now() - 1 },
    );

    expect(result.stoppedReason).toBe("time_limit");
    expect(result.passes).toHaveLength(0);
  });

  it("includes waitlist promotions in scheduled due-work runs", async () => {
    const { eventId } = await seedEventAndAdmin(baseEnv.DB);

    await baseEnv.DB.batch([
      baseEnv.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      baseEnv.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-1', 'holder@example.test', 'holder@example.test', 'Holder', 'One', datetime('now'), datetime('now')),
          ('user-2', 'waiting@example.test', 'waiting@example.test', 'Waiting', 'Two', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(baseEnv.DB, "pqc-2026");

    const holder = await createRegistration(baseEnv.DB, {
      event,
      userId: "user-1",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const confirmedHolder = await confirmRegistrationByToken(baseEnv.DB, {
      token: holder.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const waiting = await createRegistration(baseEnv.DB, {
      event,
      userId: "user-2",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(baseEnv.DB, {
      token: waiting.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    await updateRegistrationByManageToken(baseEnv.DB, {
      manageToken: confirmedHolder.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const dueWorkEnv: Env = {
      ...baseEnv,
      APP_BASE_URL: "https://app.test",
      WAITLIST_CLAIM_WINDOW_HOURS: "24",
      SCHEDULED_WAITLIST_PROMOTION_LIMIT: "10",
      SCHEDULED_REMINDER_LIMIT: "0",
      SCHEDULED_OUTBOX_LIMIT: "0",
      SCHEDULED_DUE_WORK_MAX_PASSES: "2",
      SCHEDULED_DUE_WORK_MAX_MS: "120000",
      SCHEDULED_D1_QUERY_BUDGET: "900",
    };
    const budgeted = createD1QueryBudgetedDatabase(dueWorkEnv.DB, 900);
    const result = await runScheduledDueWork({ ...dueWorkEnv, DB: budgeted.db }, { d1QueryBudget: budgeted.budget });

    expect(result.waitlistPromotions.dayRegistrationOffers).toBe(1);
    expect(result.waitlistPromotions.affectedRegistrations).toBe(1);

    const dayWaitlist = await queryAll<{ status: string }>(
      baseEnv.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
      [waiting.registration.id],
    );
    expect(dayWaitlist[0].status).toBe("offered");

    const offerOutbox = await queryAll<{
      id: string;
      idempotency_key: string;
      template_key: string;
      recipient_email: string;
    }>(
      baseEnv.DB,
      "SELECT id, idempotency_key, template_key, recipient_email FROM email_outbox WHERE template_key = 'registration_waitlist_offer' ORDER BY created_at DESC LIMIT 1",
    );
    expect(offerOutbox[0].template_key).toBe("registration_waitlist_offer");
    expect(offerOutbox[0].recipient_email).toBe("waiting@example.test");
    // The offer's operation key is the idempotency key; the row id is a UUID derived from it, so a retry finds the row.
    expect(z.uuid().safeParse(offerOutbox[0].id).success).toBe(true);
    expect(offerOutbox[0].idempotency_key).toMatch(/^waitlist-offer:/);
    expect(offerOutbox[0].id).toBe(await outboxIdForOperation(offerOutbox[0].idempotency_key));

    // Operators can list the outbox page holding the offer and open it.
    const [{ id: adminId }] = await queryAll<{ id: string }>(baseEnv.DB, ADMINISTRATOR_FIXTURE_USER_SQL);
    const adminToken = await createAdminSession(baseEnv.DB, adminId, "waitlist-outbox-admin");
    const read = (path: string) =>
      app.fetch(
        new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${adminToken}` } }),
        baseEnv as never,
        { passThroughOnException() {}, waitUntil() {} } as never,
      );
    const list = await read("/api/v1/email/outbox?limit=25&offset=0&sort=-createdAt");
    expect(list.status).toBe(200);
    const page = emailOutboxResponseSchema.parse(await list.json());
    expect(page.outbox.map((row) => row.id)).toContain(offerOutbox[0].id);
    expect((await read(`/api/v1/email/outbox/${offerOutbox[0].id}`)).status).toBe(200);
  });

  it("requeues simultaneous lapsed offers in order behind every lane and offers the freed seat", async () => {
    const { eventId } = await seedEventAndAdmin(baseEnv.DB);

    await baseEnv.DB.batch([
      baseEnv.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-lapsed', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      baseEnv.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-lapsed-second', 'lapsed-second@example.test', 'lapsed-second@example.test', 'Second', 'Offer', datetime('now'), datetime('now')),
          ('user-lapsed', 'lapsed@example.test', 'lapsed@example.test', 'Lapsed', 'Offer', datetime('now'), datetime('now')),
          ('user-next', 'next@example.test', 'next@example.test', 'Next', 'Waiting', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(baseEnv.DB, "pqc-2026");
    const register = (userId: string) =>
      createRegistration(baseEnv.DB, {
        event,
        userId,
        dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
        sourceType: "direct",
        confirmationTtlHours: 48,
        signingSecret: "test-signing-secret",
      });
    // Insert the second queue position first to expose update-order dependencies.
    const secondLapsed = await register("user-lapsed-second");
    const lapsed = await register("user-lapsed");
    const next = await register("user-next");
    const entry = (
      id: string,
      registrationId: string,
      userId: string,
      lane: "continuity" | "general",
      status: string,
      position: number,
    ) =>
      baseEnv.DB.prepare(
        `INSERT INTO event_day_waitlist_entries (
           id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position,
           offer_expires_at, reason_code, reason_note, created_at, updated_at
         ) VALUES (?, ?, 'day-lapsed', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
         ON CONFLICT(event_day_id, registration_id) DO UPDATE SET
           status = excluded.status, priority_lane = excluded.priority_lane, position = excluded.position, offer_expires_at = excluded.offer_expires_at`,
      ).bind(
        id,
        eventId,
        registrationId,
        userId,
        lane,
        status,
        position,
        status === "offered" ? new Date(Date.now() - 3600_000).toISOString() : null,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    await baseEnv.DB.batch([
      // Promotion takes the continuity lane first, so the lapsed holder must leave it to reach the back.
      entry("lapsed-offer", lapsed.registration.id, "user-lapsed", "continuity", "offered", 1),
      entry("second-lapsed-offer", secondLapsed.registration.id, "user-lapsed-second", "general", "offered", 2),
      entry("next-waiting", next.registration.id, "user-next", "general", "waiting", 3),
    ]);

    const result = await runWaitlistPromotionCycle(baseEnv.DB, {
      appBaseUrl: "https://app.test",
      claimWindowHours: 24,
      limit: 10,
    });

    expect(result.dayRegistrationOffers).toBe(1);
    expect(result.affectedRegistrations).toBe(1);
    const rows = await queryAll<{
      registration_id: string;
      priority_lane: string;
      status: string;
      position: number;
      reason_code: string | null;
    }>(
      baseEnv.DB,
      "SELECT registration_id, priority_lane, status, position, reason_code FROM event_day_waitlist_entries WHERE event_day_id = 'day-lapsed' ORDER BY position",
    );
    expect(rows).toEqual([
      {
        registration_id: next.registration.id,
        priority_lane: "general",
        status: "offered",
        position: 3,
        reason_code: null,
      },
      {
        registration_id: lapsed.registration.id,
        priority_lane: "general",
        status: "waiting",
        position: 4,
        reason_code: "offer_lapsed",
      },
      {
        registration_id: secondLapsed.registration.id,
        priority_lane: "general",
        status: "waiting",
        position: 5,
        reason_code: "offer_lapsed",
      },
    ]);
  });

  it("does not let more than one selection batch of full events starve a promotable event", async () => {
    const { eventId } = await seedEventAndAdmin(baseEnv.DB);
    const blocked = Array.from({ length: 51 }, (_, index) => index + 1);

    await baseEnv.DB.batch(
      blocked.map((index) =>
        baseEnv.DB.prepare(
          `INSERT INTO events (
             id, slug, name, timezone, starts_at, settings_json, created_at, updated_at
           ) VALUES (?, ?, ?, 'UTC', '2026-01-01T00:00:00.000Z', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        ).bind(`blocked-event-${index}`, `blocked-${index}`, `Blocked event ${String(index).padStart(2, "0")}`),
      ),
    );
    await baseEnv.DB.batch(
      blocked.map((index) =>
        baseEnv.DB.prepare(
          `INSERT INTO event_days (
             id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at
           ) VALUES (?, ?, ?, 'Blocked day', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        ).bind(`blocked-day-${index}`, `blocked-event-${index}`, "2026-01-01"),
      ),
    );
    await baseEnv.DB.batch(
      blocked.map((index) =>
        baseEnv.DB.prepare(
          `INSERT INTO users (
             id, email, normalized_email, created_at, updated_at
           ) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        ).bind(`blocked-user-${index}`, `blocked-${index}@example.test`, `blocked-${index}@example.test`),
      ),
    );
    await baseEnv.DB.batch(
      blocked.map((index) =>
        baseEnv.DB.prepare(
          `INSERT INTO registrations (
             id, event_id, user_id, status, source_type,
             manage_link_secret, created_at, updated_at
           ) VALUES (?, ?, ?, 'registered', 'direct', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        ).bind(
          `blocked-registration-${index}`,
          `blocked-event-${index}`,
          `blocked-user-${index}`,
          `blocked-manage-token-${index}`,
        ),
      ),
    );
    await baseEnv.DB.batch(
      blocked.map((index) =>
        baseEnv.DB.prepare(
          `INSERT INTO event_day_waitlist_entries (
             id, event_id, event_day_id, registration_id, user_id,
             priority_lane, status, position, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'general', 'waiting', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        ).bind(
          `blocked-waitlist-${index}`,
          `blocked-event-${index}`,
          `blocked-day-${index}`,
          `blocked-registration-${index}`,
          `blocked-user-${index}`,
        ),
      ),
    );

    await baseEnv.DB.batch([
      baseEnv.DB.prepare(
        `INSERT INTO event_days (
           id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at
         ) VALUES ('promotable-day', ?, '2026-12-01', 'Promotable day', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      ).bind(eventId),
      baseEnv.DB.prepare(
        `INSERT INTO users (
           id, email, normalized_email, created_at, updated_at
         ) VALUES (
           'promotable-user', 'promotable@example.test', 'promotable@example.test', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
         )`,
      ),
      baseEnv.DB.prepare(
        `INSERT INTO registrations (
           id, event_id, user_id, status, source_type,
           manage_link_secret, created_at, updated_at
         ) VALUES (
           'promotable-registration', ?, 'promotable-user', 'registered', 'direct',
           'promotable-manage-token', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
         )`,
      ).bind(eventId),
      baseEnv.DB.prepare(
        `INSERT INTO event_day_waitlist_entries (
           id, event_id, event_day_id, registration_id, user_id,
           priority_lane, status, position, created_at, updated_at
         ) VALUES (
           'promotable-waitlist', ?, 'promotable-day', 'promotable-registration', 'promotable-user',
           'general', 'waiting', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
         )`,
      ).bind(eventId),
    ]);

    await baseEnv.DB.batch([
      baseEnv.DB.prepare(`INSERT INTO users (id,email,normalized_email,created_at,updated_at)
        VALUES ('blocked-holder','blocked-holder@example.test','blocked-holder@example.test',
          strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
      baseEnv.DB.prepare(`INSERT INTO registrations
        (id,event_id,user_id,status,source_type,manage_link_secret,created_at,updated_at)
        SELECT 'holder-'||event.id,event.id,'blocked-holder','registered','direct','holder-manage-'||event.id,
          strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
        FROM events event WHERE event.id LIKE 'blocked-event-%'`),
    ]);
    await baseEnv.DB.prepare(`INSERT INTO registration_day_attendance
      (id,registration_id,event_day_id,attendance_type,created_at,updated_at)
      SELECT 'attendance-'||registration.id,registration.id,day.id,'in_person',
        strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM registrations registration JOIN event_days day ON day.event_id=registration.event_id
      WHERE registration.id LIKE 'blocked-registration-%' OR registration.id LIKE 'holder-blocked-event-%'
        OR registration.id='promotable-registration'`).run();

    const result = await runWaitlistPromotionCycle(baseEnv.DB, {
      appBaseUrl: "https://app.test",
      claimWindowHours: 24,
      limit: 1,
    });

    expect(result.eventsScanned).toBe(1);
    expect(result.dayRegistrationOffers).toBe(1);
    const rows = await queryAll<{ status: string }>(
      baseEnv.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE id = 'promotable-waitlist'",
    );
    expect(rows[0].status).toBe("offered");
  });
});
