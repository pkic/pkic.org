import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { getEventBySlug } from "../functions/_lib/services/events";
import { listCampaignRecipients } from "../functions/_lib/services/event-email-campaign";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { activateTemplateVersion, createTemplateVersion } from "../functions/_lib/email/templates";
import app from "../functions/router";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";
import { insertUser } from "./helpers/membership";
import { createGroup } from "../functions/_lib/services/groups";
import { createGroupManagedEvent } from "../functions/_lib/services/events/group-management";

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

function mutateBeforeMatchingBatch(
  db: DatabaseLike,
  sqlFragment: string,
  mutation: () => Promise<unknown>,
): DatabaseLike {
  let pending = true;
  const originals = new WeakMap<StatementLike, StatementLike>();
  const queries = new WeakMap<StatementLike, string>();

  function wrap(statement: StatementLike, query: string): StatementLike {
    const wrapped: StatementLike = {
      bind(...values: unknown[]) {
        return wrap(statement.bind(...values), query);
      },
      run: <T = Record<string, unknown>>() => statement.run<T>(),
      all: <T = Record<string, unknown>>() => statement.all<T>(),
      first: <T = Record<string, unknown>>(columnName?: string) => statement.first<T>(columnName),
    };
    originals.set(wrapped, statement);
    queries.set(wrapped, query);
    return wrapped;
  }

  return {
    prepare: (query) => wrap(db.prepare(query), query),
    batch: async (statements) => {
      if (pending && statements.some((statement) => queries.get(statement)?.includes(sqlFragment))) {
        pending = false;
        await mutation();
      }
      return db.batch(statements.map((statement) => originals.get(statement) ?? statement));
    },
  };
}

async function seedCampaignTemplates(actorId: string): Promise<void> {
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
      createdByUserId: actorId,
    });
    await activateTemplateVersion(env.DB, { templateKey: key, version: version.version });
  }
}

function campaignRequest(database: DatabaseLike, token: string, path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    { ...env, DB: database } as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

describe("event email campaign recipients", () => {
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
    await seedCampaignTemplates(admin.id);
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
    const makeRequest = (requestBody: unknown, action: "preview" | "create") =>
      new Request(
        action === "preview"
          ? "https://app.test/api/v1/events/pqc-2026/email/campaigns/previews"
          : "https://app.test/api/v1/events/pqc-2026/email/campaigns",
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${rawToken}` },
          body: JSON.stringify(requestBody),
        },
      );
    const previewResponse = await app.fetch(
      makeRequest(body, "preview"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
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
    let backgroundCalls = 0;
    const sendResponse = await app.fetch(
      makeRequest({ ...body, previewToken: preview.previewToken }, "create"),
      { ...env, DB: batchDb } as any,
      {
        passThroughOnException: () => {},
        waitUntil: () => {
          backgroundCalls += 1;
        },
      } as any,
    );
    const sendBody = (await sendResponse.json()) as {
      queuedRecipients: number;
      queuedBatches: number;
    };

    expect(sendResponse.status).toBe(202);
    expect(sendBody.queuedRecipients).toBe(users.length);
    expect(sendBody.queuedBatches).toBe(users.length);
    expect(batchCalls).toBeLessThanOrEqual(12);
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

  it("supports event-scoped writers and atomically rejects permission revocation before queue commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [{ id: administratorId }] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1",
    );
    await seedCampaignTemplates(administratorId);
    const writerId = await insertUser(env.DB, `campaign-writer-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'events:write', 'event', ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), writerId, eventId, administratorId)
      .run();
    const token = await createAdminSession(env.DB, writerId, `campaign-writer-${crypto.randomUUID()}`);
    const attendeeId = await insertUser(env.DB, `campaign-attendee-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare(
      `INSERT INTO registrations
         (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
       VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), eventId, attendeeId, crypto.randomUUID())
      .run();
    const input = {
      subjectOverride: "Scoped event update",
      bodyContent: "Hello {{firstName}}",
      messageType: "transactional" as const,
      sendMode: "personal" as const,
      batchSize: 50,
      filter: { audience: "attendees" as const, attendeeStatus: "registered" as const },
    };
    const preview = await campaignRequest(env.DB, token, "/api/v1/events/pqc-2026/email/campaigns/previews", input);
    expect(preview.status, await preview.clone().text()).toBe(200);
    const previewBody = (await preview.json()) as { previewToken: string };

    const racedDb = mutateBeforeMatchingBatch(env.DB, "INSERT INTO email_outbox", () =>
      env.DB.prepare(
        `UPDATE permission_grants
            SET revoked_at = datetime('now')
          WHERE user_id = ? AND permission = 'events:write' AND context_type = 'event' AND context_id = ?`,
      )
        .bind(writerId, eventId)
        .run(),
    );
    const create = await campaignRequest(racedDb, token, "/api/v1/events/pqc-2026/email/campaigns", {
      ...input,
      previewToken: previewBody.previewToken,
    });
    expect(create.status, await create.clone().text()).toBe(409);
    await expect(create.json()).resolves.toMatchObject({ error: { code: "EVENT_COMMUNICATION_ACCESS_CHANGED" } });
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox").first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
  });

  it("uses the same campaign resource for a selected group event manager", async () => {
    const administratorId = await insertUser(env.DB, `campaign-admin-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(administratorId).run();
    const administrator = {
      identityType: "user" as const,
      id: administratorId,
      email: `campaign-admin-${administratorId}@example.test`,
      role: "admin",
    };
    const group = await createGroup(env.DB, administrator, {
      typeKey: "working_group",
      name: `Campaign group ${crypto.randomUUID()}`,
      visibility: "authenticated",
      eligibilityMode: "open",
    });
    const created = await createGroupManagedEvent(env.DB, administrator, group.id, {
      name: "Campaign group event",
      slug: `campaign-group-event-${crypto.randomUUID()}`,
      timezone: "Europe/Amsterdam",
      startsAt: "2027-04-12T08:00:00.000Z",
      endsAt: "2027-04-12T17:00:00.000Z",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      inviteLimitAttendee: 5,
      location: "Online",
      links: [],
    });
    const token = await createAdminSession(env.DB, administratorId, `campaign-group-${crypto.randomUUID()}`);
    const response = await campaignRequest(
      env.DB,
      token,
      `/api/v1/groups/${group.id}/events/${created.eventId}/email/campaigns/previews`,
      {
        subjectOverride: "Group event update",
        bodyContent: "Hello",
        messageType: "transactional",
        sendMode: "personal",
        batchSize: 50,
        filter: { audience: "attendees", attendeeStatus: "registered" },
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, recipientCount: 0 });
  });
});
