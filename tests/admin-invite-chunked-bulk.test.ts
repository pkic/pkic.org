/**
 * admin-invite-chunked-bulk.test.ts
 *
 * Verifies the chunked-send protocol introduced to support large CSV uploads
 * (>500 invitees).  The frontend:
 *
 *  1. POSTs all invites to the preview endpoint → receives previewToken + inviteDigest
 *  2. Splits the list into 500-row chunks and POSTs each chunk to the bulk
 *     endpoint, passing the original inviteDigest so the HMAC token (signed
 *     against the full list) still validates correctly.
 *
 * Tests:
 *  - Preview response includes inviteDigest
 *  - Bulk accepts a chunk that differs from the full list when inviteDigest matches
 *  - Bulk rejects a chunk without inviteDigest when the chunk ≠ full list
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import app from "../functions/router";
import { handleError } from "../functions/_lib/http";
import { bulkCreateAttendeesAdmin, bulkCreateInvites } from "../functions/_lib/services/invite-bulk";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import type { DatabaseLike, Env as AppEnv } from "../functions/_lib/types";
import { mutateBeforeNextBatch } from "./helpers/database-races";

const appEnv = env as unknown as AppEnv;

const EVENT_SLUG = "pqc-2026";
let RAW_TOKEN = "chunked-bulk-test-token";

async function seedRequiredTemplates(adminId: string): Promise<void> {
  for (const [key, content, subject] of [
    ["email_layout", "{{{body_html}}}", null],
    ["attendee_invite", "Join: {{registrationUrl}}", "Invite to {{eventName}}"],
  ] as [string, string, string | null][]) {
    const v = await createTemplateVersion(appEnv.DB, {
      templateKey: key,
      content,
      subjectTemplate: subject,
      createdByUserId: adminId,
    });
    await activateTemplateVersion(appEnv.DB, { templateKey: key, version: v.version });
  }
}

function makeRequest(action: "preview" | "bulk", body: unknown): Request {
  return new Request(`https://app.test/api/v1/admin/events/${EVENT_SLUG}/invites/attendees/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${RAW_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

function callMounted(action: "preview" | "bulk", body: unknown): Promise<Response> {
  return app.fetch(
    makeRequest(action, body),
    appEnv as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

describe("attendee invite — chunked bulk send", () => {
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(appEnv.DB);
    const row = (await queryAll<{ id: string }>(appEnv.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    adminId = row.id;
    RAW_TOKEN = await createAdminSession(appEnv.DB, adminId, RAW_TOKEN);
    await seedRequiredTemplates(adminId);
  });

  it("preview response includes inviteDigest", async () => {
    const invites = [
      { email: "a@example.com", firstName: "Alice", lastName: "A" },
      { email: "b@example.com", firstName: "Bob", lastName: "B" },
    ];
    const res = await callMounted("preview", { invites });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.previewToken).toBeTypeOf("string");
    expect(body.inviteDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.recipientCount).toBe(2);
  });

  it("bulk accepts a chunk with the full-list inviteDigest", async () => {
    // Preview issued for two invitees
    const allInvites = [
      { email: "a@example.com", firstName: "Alice", lastName: "A" },
      { email: "b@example.com", firstName: "Bob", lastName: "B" },
    ];
    const previewRes = await callMounted("preview", { invites: allInvites });
    const { previewToken, inviteDigest } = (await previewRes.json()) as Record<string, string>;

    // Send only the first invitee as a "chunk" — pass the full-list digest so
    // the token (signed over both invitees) still validates.
    const chunk = [{ email: "a@example.com", firstName: "Alice", lastName: "A" }];
    const bulkRes = await callMounted("bulk", { invites: chunk, previewToken, inviteDigest });

    expect(bulkRes.status).toBe(200);
    const bulkBody = (await bulkRes.json()) as { success: boolean; created: unknown[] };
    expect(bulkBody.success).toBe(true);
    expect(bulkBody.created).toHaveLength(1);
    await expect(
      queryAll<{ expires_at: string }>(appEnv.DB, "SELECT expires_at FROM invites WHERE invitee_email = ?", [
        "a@example.com",
      ]),
    ).resolves.toEqual([{ expires_at: "2026-12-01T08:00:00.000Z" }]);
  });

  it("bulk rejects a chunk when inviteDigest is omitted and chunk ≠ full list", async () => {
    // Preview issued for two invitees
    const allInvites = [
      { email: "a@example.com", firstName: "Alice", lastName: "A" },
      { email: "b@example.com", firstName: "Bob", lastName: "B" },
    ];
    const previewRes = await callMounted("preview", { invites: allInvites });
    const { previewToken } = (await previewRes.json()) as Record<string, string>;

    // Send only the first invitee without passing inviteDigest — the worker
    // will compute the digest from the chunk alone, which differs from the
    // full-list digest embedded in the token → 409 INVITE_PREVIEW_STALE.
    const chunk = [{ email: "a@example.com", firstName: "Alice", lastName: "A" }];
    const bulkRes = await callMounted("bulk", { invites: chunk, previewToken }).catch(handleError);

    expect(bulkRes.status).toBe(409);
    const bulkBody = (await bulkRes.json()) as { error: { code: string } };
    expect(bulkBody.error.code).toBe("INVITE_PREVIEW_STALE");
  });

  it("creates hundreds of invites within a bounded D1 query budget", async () => {
    const event = (
      await queryAll<{ id: string; starts_at: string; ends_at: string }>(
        appEnv.DB,
        "SELECT id, starts_at, ends_at FROM events WHERE slug = ?",
        [EVENT_SLUG],
      )
    )[0];
    const budgeted = createD1QueryBudgetedDatabase(appEnv.DB, 9);
    const invites = Array.from({ length: 501 }, (_, index) => ({
      inviteeEmail: `bounded-invite-${index}@example.test`,
    }));

    const outcomes = await bulkCreateAttendeesAdmin(budgeted.db, {
      event,
      invites,
      buildEmailRow: ({ email }) => ({
        eventId: event.id,
        recipientEmail: email,
        templateKey: "attendee_invite",
        subject: "Bounded invite",
        data: {},
      }),
    });

    expect(outcomes.filter((outcome) => outcome.status === "created")).toHaveLength(invites.length);
    // One expiry transition + three classification reads + one atomic event-window guard,
    // two JSON invite inserts, and two JSON outbox inserts.
    expect(budgeted.budget.usedQueries()).toBe(9);
  });

  it("replaces an expired sent row instead of treating it as an active duplicate", async () => {
    const event = (
      await queryAll<{ id: string; starts_at: string; ends_at: string }>(
        appEnv.DB,
        "SELECT id, starts_at, ends_at FROM events WHERE slug = ?",
        [EVENT_SLUG],
      )
    )[0];
    const priorId = crypto.randomUUID();
    await appEnv.DB.prepare(
      `INSERT INTO invites
           (id, event_id, invitee_email, invite_type, link_secret, status, source_type, expires_at, created_at)
         VALUES (?, ?, 'replaced-expired@example.test', 'attendee', ?, 'sent', 'test', '2026-01-01T00:00:00.000Z', ?)`,
    )
      .bind(priorId, event.id, crypto.randomUUID(), "2026-01-01T00:00:00.000Z")
      .run();

    const outcomes = await bulkCreateAttendeesAdmin(appEnv.DB, {
      event,
      invites: [{ inviteeEmail: "replaced-expired@example.test" }],
    });

    expect(outcomes).toMatchObject([{ status: "created", email: "replaced-expired@example.test" }]);
    await expect(
      queryAll<{ id: string; status: string }>(
        appEnv.DB,
        "SELECT id, status FROM invites WHERE invitee_email = ? ORDER BY created_at, id",
        ["replaced-expired@example.test"],
      ),
    ).resolves.toEqual([{ id: priorId, status: "expired" }, expect.objectContaining({ status: "sent" })]);
  });

  it("commits invite creation and its outbox intent atomically", async () => {
    const event = (
      await queryAll<{ id: string; starts_at: string; ends_at: string }>(
        appEnv.DB,
        "SELECT id, starts_at, ends_at FROM events WHERE slug = ?",
        [EVENT_SLUG],
      )
    )[0];
    let batchCall = 0;
    const failingDb: DatabaseLike = {
      prepare: (query) => appEnv.DB.prepare(query),
      batch: (statements) => {
        batchCall += 1;
        if (batchCall === 2) {
          return appEnv.DB.batch([
            ...statements,
            appEnv.DB.prepare("INSERT INTO missing_invite_atomicity_table (id) VALUES ('x')"),
          ]);
        }
        return appEnv.DB.batch(statements);
      },
    };

    await expect(
      bulkCreateAttendeesAdmin(failingDb, {
        event,
        invites: [{ inviteeEmail: "atomic-invite@example.test" }],
        buildEmailRow: ({ email }) => ({
          eventId: event.id,
          recipientEmail: email,
          templateKey: "attendee_invite",
          subject: "Atomic invite",
          data: {},
        }),
      }),
    ).rejects.toThrow();

    expect(
      await queryAll(appEnv.DB, "SELECT id FROM invites WHERE invitee_email = 'atomic-invite@example.test'"),
    ).toHaveLength(0);
    expect(
      await queryAll(appEnv.DB, "SELECT id FROM email_outbox WHERE recipient_email = 'atomic-invite@example.test'"),
    ).toHaveLength(0);
  });

  it("rejects bulk creation when the event schedule changes after classification", async () => {
    const event = (
      await queryAll<{ id: string; starts_at: string; ends_at: string }>(
        appEnv.DB,
        "SELECT id, starts_at, ends_at FROM events WHERE slug = ?",
        [EVENT_SLUG],
      )
    )[0];
    const racingDb = mutateBeforeNextBatch(appEnv.DB, async () => {
      await appEnv.DB.prepare("UPDATE events SET ends_at = starts_at WHERE id = ?").bind(event.id).run();
    });

    await expect(
      bulkCreateAttendeesAdmin(racingDb, {
        event,
        invites: [{ inviteeEmail: "schedule-race@example.test" }],
        buildEmailRow: ({ email }) => ({
          eventId: event.id,
          recipientEmail: email,
          templateKey: "attendee_invite",
          subject: "Schedule race",
          data: {},
        }),
      }),
    ).rejects.toMatchObject({ code: "EVENT_INVITE_WINDOW_CHANGED", status: 409 });
    await expect(
      queryAll(appEnv.DB, "SELECT id FROM invites WHERE invitee_email = 'schedule-race@example.test'"),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(appEnv.DB, "SELECT id FROM email_outbox WHERE recipient_email = 'schedule-race@example.test'"),
    ).resolves.toHaveLength(0);
  });

  it("allows only one concurrent active invite and matching outbox intent", async () => {
    const event = (
      await queryAll<{ id: string; starts_at: string; ends_at: string }>(
        appEnv.DB,
        "SELECT id, starts_at, ends_at FROM events WHERE slug = ?",
        [EVENT_SLUG],
      )
    )[0];
    const create = () =>
      bulkCreateAttendeesAdmin(appEnv.DB, {
        event,
        invites: [{ inviteeEmail: "concurrent-bulk-invite@example.test" }],
        buildEmailRow: ({ email }) => ({
          eventId: event.id,
          recipientEmail: email,
          templateKey: "attendee_invite",
          subject: "Concurrent invite",
          data: {},
        }),
      });

    const [first, second] = await Promise.all([create(), create()]);
    expect([first[0].status, second[0].status].sort()).toEqual(["created", "endorsed"]);
    expect(
      await queryAll(appEnv.DB, "SELECT id FROM invites WHERE invitee_email = 'concurrent-bulk-invite@example.test'"),
    ).toHaveLength(1);
    expect(
      await queryAll(
        appEnv.DB,
        "SELECT id FROM email_outbox WHERE recipient_email = 'concurrent-bulk-invite@example.test'",
      ),
    ).toHaveLength(1);
  });

  it("enforces peer quota atomically and makes repeat endorsements idempotent", async () => {
    const event = (
      await queryAll<{ id: string; starts_at: string; ends_at: string }>(
        appEnv.DB,
        "SELECT id, starts_at, ends_at FROM events WHERE slug = ?",
        [EVENT_SLUG],
      )
    )[0];
    const makePeerInvite = (email: string) =>
      bulkCreateInvites(appEnv.DB, "attendee", {
        event,
        inviter: { userId: adminId, registrationId: null },
        maxPrimaryInvites: 1,
        invites: [{ inviteeEmail: email, sourceType: "peer-invite" }],
        buildEmailRow: ({ email: recipientEmail }) => ({
          eventId: event.id,
          recipientEmail,
          templateKey: "attendee_invite",
          subject: "Peer invite",
          data: {},
        }),
      });

    const [first, second] = await Promise.all([
      makePeerInvite("quota-one@example.test"),
      makePeerInvite("quota-two@example.test"),
    ]);
    expect([first[0].status, second[0].status].sort()).toEqual(["created", "skipped"]);

    const createdEmail = first[0].status === "created" ? first[0].email : second[0].email;
    const repeated = await makePeerInvite(createdEmail);
    expect(repeated[0].status).toBe("endorsed");

    const invites = await queryAll<{ id: string }>(
      appEnv.DB,
      "SELECT id FROM invites WHERE event_id = ? AND inviter_user_id = ? AND invite_type = 'attendee'",
      [event.id, adminId],
    );
    expect(invites).toHaveLength(1);
    expect(
      await queryAll(appEnv.DB, "SELECT id FROM invite_inviters WHERE invite_id = ? AND inviter_user_id = ?", [
        invites[0].id,
        adminId,
      ]),
    ).toHaveLength(1);
    expect(
      await queryAll(
        appEnv.DB,
        "SELECT id FROM engagement_events WHERE subject_ref = ? AND action_type = 'invite_sent'",
        [invites[0].id],
      ),
    ).toHaveLength(1);
    expect(
      await queryAll(appEnv.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", [createdEmail]),
    ).toHaveLength(1);
  });
});
