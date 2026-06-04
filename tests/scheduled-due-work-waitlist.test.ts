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
import { runScheduledDueWork } from "../functions/_lib/services/scheduled-due-work";
import type { Env } from "../functions/_lib/types";

const baseEnv = workerEnv as unknown as Env;

describe("scheduled due work waitlist promotions", () => {
  beforeEach(async () => {
    await resetDb();
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
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    const confirmedHolder = await confirmRegistrationByToken(baseEnv.DB, {
      token: holder.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    const waiting = await createRegistration(baseEnv.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    await confirmRegistrationByToken(baseEnv.DB, {
      token: waiting.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    await updateRegistrationByManageToken(baseEnv.DB, {
      manageToken: confirmedHolder.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
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
      SCHEDULED_DUE_WORK_MAX_SUBREQUESTS: "9000",
    };

    const result = await runScheduledDueWork(dueWorkEnv);

    expect(result.waitlistPromotions.dayRegistrationOffers).toBe(1);
    expect(result.waitlistPromotions.affectedRegistrations).toBe(1);

    const dayWaitlist = await queryAll<{ status: string }>(
      baseEnv.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
      [waiting.registration.id],
    );
    expect(dayWaitlist[0].status).toBe("offered");

    const offerOutbox = await queryAll<{ template_key: string; recipient_email: string }>(
      baseEnv.DB,
      "SELECT template_key, recipient_email FROM email_outbox WHERE template_key = 'registration_waitlist_offer' ORDER BY created_at DESC LIMIT 1",
    );
    expect(offerOutbox[0].template_key).toBe("registration_waitlist_offer");
    expect(offerOutbox[0].recipient_email).toBe("waiting@example.test");
  });
});
