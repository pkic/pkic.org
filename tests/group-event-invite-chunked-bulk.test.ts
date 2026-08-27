/**
 * group-event-invite-chunked-bulk.test.ts
 *
 * Verifies the recipient-bound chunked-send protocol for large CSV uploads.
 *
 *  1. POSTs all invites to the preview endpoint.
 *  2. Receives one independently signed send token per 500-row recipient batch.
 *  3. POSTs each exact batch with its own token and digest.
 *
 * Tests:
 *  - Preview response describes every bounded send batch.
 *  - Bulk accepts the exact recipient batch that was previewed.
 *  - Bulk rejects recipient substitution even when the caller replays a valid digest.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import app from "../functions/router";
import { handleError } from "../functions/_lib/http";
import { bulkCreateAttendeeInvites, bulkCreateInvites } from "../functions/_lib/services/invite-bulk";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import type { DatabaseLike, Env as AppEnv } from "../functions/_lib/types";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { createGroupEventInvitationFixture } from "./helpers/group-event-invitations";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";

const appEnv = env as unknown as AppEnv;

let rawToken = "";
let basePath = "";
let eventSlug = "";

function makeRequest(action: "preview" | "bulk", body: unknown): Request {
  return new Request(`https://app.test${basePath}/attendees/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${rawToken}`,
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
    const fixture = await createGroupEventInvitationFixture(appEnv.DB, "chunked-bulk", {
      startsAt: "2026-12-01T08:00:00.000Z",
      endsAt: "2026-12-04T18:00:00.000Z",
    });
    adminId = fixture.actor.id;
    rawToken = fixture.token;
    basePath = fixture.basePath;
    eventSlug = fixture.eventSlug;
    await seedWorkflowEmailTemplates(appEnv.DB, adminId);
  });

  it("preview response includes recipient-bound send batches", async () => {
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
    expect(body.sendBatches).toEqual([
      {
        offset: 0,
        count: 2,
        previewToken: body.previewToken,
        inviteDigest: body.inviteDigest,
      },
    ]);
  });

  it("bulk accepts the exact recipient batch that was previewed", async () => {
    const invites = [
      { email: "a@example.com", firstName: "Alice", lastName: "A" },
      { email: "b@example.com", firstName: "Bob", lastName: "B" },
    ];
    const previewRes = await callMounted("preview", { invites });
    const { previewToken, inviteDigest } = (await previewRes.json()) as Record<string, string>;
    const bulkRes = await callMounted("bulk", { invites, previewToken, inviteDigest });

    expect(bulkRes.status).toBe(200);
    const bulkBody = (await bulkRes.json()) as { success: boolean; created: unknown[] };
    expect(bulkBody.success).toBe(true);
    expect(bulkBody.created).toHaveLength(2);
    await expect(
      queryAll<{ expires_at: string }>(appEnv.DB, "SELECT expires_at FROM invites WHERE invitee_email = ?", [
        "a@example.com",
      ]),
    ).resolves.toEqual([{ expires_at: "2026-12-01T08:00:00.000Z" }]);
    const outbox = await queryAll<{ payload_json: string }>(
      appEnv.DB,
      "SELECT payload_json FROM email_outbox WHERE recipient_email = ?",
      "a@example.com",
    );
    expect(JSON.parse(outbox[0].payload_json)).toMatchObject({
      firstName: { __pkicEmailPlainText: "Alice" },
      lastName: { __pkicEmailPlainText: "A" },
      attendeeName: { __pkicEmailPlainText: "Alice A" },
    });
  });

  it("rejects recipient substitution even when a valid full-list digest is replayed", async () => {
    const allInvites = [
      { email: "a@example.com", firstName: "Alice", lastName: "A" },
      { email: "b@example.com", firstName: "Bob", lastName: "B" },
    ];
    const previewRes = await callMounted("preview", { invites: allInvites });
    const { previewToken, inviteDigest } = (await previewRes.json()) as Record<string, string>;

    const substituted = [{ email: "attacker-chosen@example.com", firstName: "Mallory", lastName: "M" }];
    const bulkRes = await callMounted("bulk", {
      invites: substituted,
      previewToken,
      inviteDigest,
    }).catch(handleError);

    expect(bulkRes.status).toBe(409);
    const bulkBody = (await bulkRes.json()) as { error: { code: string } };
    expect(bulkBody.error.code).toBe("INVITE_PREVIEW_STALE");
    await expect(
      queryAll(appEnv.DB, "SELECT id FROM invites WHERE invitee_email = 'attacker-chosen@example.com'"),
    ).resolves.toHaveLength(0);
  });

  it("issues independently bound tokens for lists larger than one D1 send batch", async () => {
    const invites = Array.from({ length: 501 }, (_, index) => ({ email: `batch-${index}@example.test` }));
    const previewRes = await callMounted("preview", { invites });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as {
      sendBatches: Array<{ offset: number; count: number; previewToken: string; inviteDigest: string }>;
    };
    expect(preview.sendBatches.map(({ offset, count }) => ({ offset, count }))).toEqual([
      { offset: 0, count: 500 },
      { offset: 500, count: 1 },
    ]);

    const second = preview.sendBatches[1];
    const bulkRes = await callMounted("bulk", {
      invites: invites.slice(second.offset, second.offset + second.count),
      previewToken: second.previewToken,
      inviteDigest: second.inviteDigest,
    });
    expect(bulkRes.status, await bulkRes.clone().text()).toBe(200);
    await expect(
      queryAll(appEnv.DB, "SELECT id FROM invites WHERE invitee_email = 'batch-500@example.test'"),
    ).resolves.toHaveLength(1);
  });

  it("creates hundreds of invites within a bounded D1 query budget", async () => {
    const event = (
      await queryAll<{ id: string; starts_at: string; ends_at: string }>(
        appEnv.DB,
        "SELECT id, starts_at, ends_at FROM events WHERE slug = ?",
        [eventSlug],
      )
    )[0];
    const budgeted = createD1QueryBudgetedDatabase(appEnv.DB, 9);
    const invites = Array.from({ length: 501 }, (_, index) => ({
      inviteeEmail: `bounded-invite-${index}@example.test`,
    }));

    const outcomes = await bulkCreateAttendeeInvites(budgeted.db, {
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
        [eventSlug],
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

    const outcomes = await bulkCreateAttendeeInvites(appEnv.DB, {
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
        [eventSlug],
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
      bulkCreateAttendeeInvites(failingDb, {
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
        [eventSlug],
      )
    )[0];
    const racingDb = mutateBeforeNextBatch(appEnv.DB, async () => {
      await appEnv.DB.prepare("UPDATE events SET ends_at = starts_at WHERE id = ?").bind(event.id).run();
    });

    await expect(
      bulkCreateAttendeeInvites(racingDb, {
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
        [eventSlug],
      )
    )[0];
    const create = () =>
      bulkCreateAttendeeInvites(appEnv.DB, {
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
        [eventSlug],
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
