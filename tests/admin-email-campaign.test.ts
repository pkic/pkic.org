import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { getEventBySlug } from "../functions/_lib/services/events";
import { listCampaignRecipients } from "../functions/_lib/services/admin-email-campaign";
import { resetDb } from "./helpers/reset-db";
import { createContext, queryAll, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { activateTemplateVersion, createTemplateVersion } from "../functions/_lib/email/templates";
import { onRequestPost as campaignPreview } from "../functions/api/v1/admin/events/[eventSlug]/emails/campaign/preview";
import { onRequestPost as campaignSend } from "../functions/api/v1/admin/events/[eventSlug]/emails/campaign/send";
import type { DatabaseLike, Env as AppEnv, StatementLike } from "../functions/_lib/types";

const appEnv = env as unknown as AppEnv;

function countingDatabase(db: DatabaseLike, counts: { dayAttendance: number; dayWaitlist: number }): DatabaseLike {
  function wrapStatement(statement: StatementLike, query: string): StatementLike {
    const normalizedQuery = query.toLowerCase();
    const queryType = normalizedQuery.includes("select rda.registration_id")
      ? "dayAttendance"
      : normalizedQuery.includes("select w.registration_id")
        ? "dayWaitlist"
        : null;

    function countExecution(): void {
      if (queryType) counts[queryType] += 1;
    }

    return {
      bind(...values: unknown[]) {
        return wrapStatement(statement.bind(...values), query);
      },
      async all<T>() {
        countExecution();
        return statement.all<T>();
      },
      async first<T>(columnName?: string) {
        countExecution();
        return statement.first<T>(columnName);
      },
      async run<T>() {
        countExecution();
        return statement.run<T>();
      },
    };
  }

  return {
    prepare(query: string) {
      return wrapStatement(db.prepare(query), query);
    },
    batch(statements) {
      return db.batch(statements);
    },
  };
}

describe("admin email campaign recipients", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("loads attendee details for a large event without per-recipient query batches", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const users = Array.from({ length: 101 }, (_, index) => ({
      id: `campaign-user-${index}`,
      email: `campaign-user-${index}@example.test`,
      manageTokenHash: `campaign-manage-token-${index}`,
      registrationId: `campaign-registration-${index}`,
      attendanceType: index === 100 ? "in_person" : "virtual",
    }));

    await env.DB.batch(
      users.map((user) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(user.id, user.email, user.email, "Campaign", `User ${user.id.split("-").pop()}`),
      ),
    );
    await env.DB.batch(
      users.map((user) =>
        env.DB.prepare(
          `INSERT INTO registrations (
               id, event_id, user_id, status, attendance_type, source_type,
               manage_link_secret, created_at, updated_at
             ) VALUES (?, ?, ?, 'registered', ?, 'direct', ?, datetime('now'), datetime('now'))`,
        ).bind(user.registrationId, eventId, user.id, user.attendanceType, user.manageTokenHash),
      ),
    );

    const enrichedUser = users[100];
    if (!enrichedUser) throw new Error("Expected the 101st campaign user to exist");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind("campaign-day-101", eventId, "2026-12-02", "Day 2", 10),
      env.DB.prepare(
        `INSERT INTO registration_day_attendance (
             id, registration_id, event_day_id, attendance_type, created_at, updated_at
           ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind("campaign-attendance-101", enrichedUser.registrationId, "campaign-day-101", "in_person"),
      env.DB.prepare(
        `INSERT INTO event_day_waitlist_entries (
             id, event_id, event_day_id, registration_id, user_id, priority_lane,
             status, position, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'general', 'waiting', ?, datetime('now'), datetime('now'))`,
      ).bind("campaign-waitlist-101", eventId, "campaign-day-101", enrichedUser.registrationId, enrichedUser.id, 1),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const enrichmentQueryCounts = { dayAttendance: 0, dayWaitlist: 0 };
    const recipients = await listCampaignRecipients(
      countingDatabase(env.DB, enrichmentQueryCounts),
      event,
      "https://app.test",
      {
        audience: "attendees",
        attendeeStatus: "registered",
        dayWaitlistStatus: "all",
      },
    );

    expect(recipients).toHaveLength(users.length);
    expect(recipients[0].templateData.dayWaitlist).toEqual([]);
    const enrichedRecipient = recipients.find((recipient) => recipient.email === enrichedUser.email);
    expect(enrichedRecipient?.templateData.dayAttendance).toEqual([
      {
        dayLabel: "Day 2",
        attendanceLabel: "In person",
        statusLabel: "Waitlisted for in-person attendance",
        waitlistStatus: "waiting",
        isWaitlisted: true,
        isWaitlistOffer: false,
      },
    ]);
    expect(enrichedRecipient?.templateData.dayWaitlist).toEqual([{ dayDate: "2026-12-02", status: "waiting" }]);
    expect(enrichmentQueryCounts.dayAttendance).toBe(1);
    expect(enrichmentQueryCounts.dayWaitlist).toBe(1);
  });

  it("rejects an over-limit audience before loading per-registration enrichment", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const users = Array.from({ length: 3 }, (_, index) => ({
      id: `limited-campaign-user-${index}`,
      email: `limited-campaign-user-${index}@example.test`,
      registrationId: `limited-campaign-registration-${index}`,
    }));
    await env.DB.batch(
      users.flatMap((user) => [
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(user.id, user.email, user.email),
        env.DB.prepare(
          `INSERT INTO registrations (
             id, event_id, user_id, status, attendance_type, source_type,
             manage_link_secret, created_at, updated_at
           ) VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, datetime('now'), datetime('now'))`,
        ).bind(user.registrationId, eventId, user.id, `limited-token-${user.id}`),
      ]),
    );

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const enrichmentQueryCounts = { dayAttendance: 0, dayWaitlist: 0 };
    await expect(
      listCampaignRecipients(
        countingDatabase(env.DB, enrichmentQueryCounts),
        event,
        "https://app.test",
        { audience: "attendees", attendeeStatus: "registered" },
        { maxRecipients: 2 },
      ),
    ).rejects.toMatchObject({ status: 422, code: "CAMPAIGN_RECIPIENT_LIMIT_EXCEEDED" });
    expect(enrichmentQueryCounts).toEqual({ dayAttendance: 0, dayWaitlist: 0 });
  });

  it("queues a large personal campaign in bounded D1 batches", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    if (!admin) throw new Error("Expected the seeded admin to exist");
    const rawToken = await createAdminSession(env.DB, admin.id, "campaign-bulk-test-token");
    for (const key of [
      "email_layout",
      "partial_reg_details",
      "partial_sponsors_block",
      "partial_about_pkic",
      "partial_donation_request",
    ]) {
      const version = await createTemplateVersion(env.DB, {
        templateKey: key,
        content: key === "email_layout" ? "{{{body_html}}}" : "Details",
        subjectTemplate: null,
        createdByUserId: admin.id,
      });
      await activateTemplateVersion(env.DB, { templateKey: key, version: version.version });
    }
    const users = Array.from({ length: 251 }, (_, index) => ({
      id: `campaign-send-user-${index}`,
      email: `campaign-send-user-${index}@example.test`,
      registrationId: `campaign-send-registration-${index}`,
    }));

    for (let offset = 0; offset < users.length; offset += 250) {
      const slice = users.slice(offset, offset + 250);
      await env.DB.batch([
        ...slice.map((user) =>
          env.DB.prepare(
            `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          ).bind(user.id, user.email, user.email, "Campaign", `User ${offset}`),
        ),
        ...slice.map((user) =>
          env.DB.prepare(
            `INSERT INTO registrations (
                 id, event_id, user_id, status, attendance_type, source_type,
                 manage_link_secret, created_at, updated_at
               ) VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, datetime('now'), datetime('now'))`,
          ).bind(user.registrationId, eventId, user.id, `original-manage-token-${user.id}`),
        ),
      ]);
    }

    const body = {
      subjectOverride: "Campaign update",
      bodyContent: "Hello {{firstName}}",
      messageType: "promotional" as const,
      sendMode: "personal" as const,
      batchSize: 500,
      filter: { audience: "attendees" as const, attendeeStatus: "registered" as const },
    };
    const makeRequest = (requestBody: unknown) =>
      new Request("https://app.test", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${rawToken}` },
        body: JSON.stringify(requestBody),
      });
    const previewResponse = await campaignPreview(createContext(appEnv, makeRequest(body), { eventSlug: "pqc-2026" }));
    const preview = (await previewResponse.json()) as { previewToken: string };
    expect(previewResponse.status).toBe(200);

    let batchCalls = 0;
    const batchDb: DatabaseLike = {
      prepare: (query) => env.DB.prepare(query),
      batch: (statements) => {
        batchCalls += 1;
        return env.DB.batch(statements);
      },
    };
    const sendContext = createContext(appEnv, makeRequest({ ...body, previewToken: preview.previewToken }), {
      eventSlug: "pqc-2026",
    });
    sendContext.var = { requestDb: batchDb };
    let backgroundCalls = 0;
    sendContext.executionCtx.waitUntil = () => {
      backgroundCalls += 1;
    };

    const sendResponse = await campaignSend(sendContext);
    const sendBody = (await sendResponse.json()) as {
      queuedRecipients: number;
      queuedBatches: number;
    };

    expect(sendResponse.status).toBe(200);
    expect(sendBody.queuedRecipients).toBe(users.length);
    expect(sendBody.queuedBatches).toBe(users.length);
    expect(batchCalls).toBe(1);
    expect(backgroundCalls).toBe(1);
    expect((await queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox"))[0]?.count).toBe(
      users.length,
    );
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          "SELECT COUNT(*) AS count FROM registrations WHERE manage_link_secret LIKE 'original-manage-token-%'",
        )
      )[0]?.count,
    ).toBe(users.length);
  });
});
