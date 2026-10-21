import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { listProposalAuditLog } from "../functions/_lib/services/audit-log-read";
import { getAttendanceStatusByType } from "../functions/_lib/services/registrations/attendance-statistics";
import { seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

describe("indexed audit and attendance query results", () => {
  it("preserves scoped and legacy proposal entries without duplicates, including filtered pages", async () => {
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `INSERT INTO session_proposals
        (id, event_id, proposer_user_id, status, proposal_type, title, abstract, manage_link_secret, submitted_at, updated_at)
       VALUES ('proposal', ?, ?, 'submitted', 'talk', 'Test', ?, 'secret', ?, ?)`,
    )
      .bind(eventId, admin.id, "A".repeat(80), "2026-10-21T00:00:00.000Z", "2026-10-21T00:00:00.000Z")
      .run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO proposal_reviews
          (id, proposal_id, reviewer_user_id, recommendation, created_at, updated_at)
         VALUES ('review', 'proposal', ?, 'accept', ?, ?)`,
      ).bind(admin.id, "2026-10-21T00:00:00.000Z", "2026-10-21T00:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO proposal_speakers (id, proposal_id, user_id, role, created_at)
         VALUES ('speaker', 'proposal', ?, 'speaker', ?)`,
      ).bind(admin.id, "2026-10-21T00:00:00.000Z"),
    ]);
    const entries = [
      ["scoped", "proposal", "proposal", "proposal", "proposal"],
      ["scoped-deleted-child", "proposal_review", "deleted-review", "proposal", "proposal"],
      ["legacy-proposal", "proposal", "proposal", null, null],
      ["legacy-review", "proposal_review", "review", null, null],
      ["legacy-speaker", "proposal_speaker", "speaker", null, null],
      ["other-scope", "proposal_review", "review", "proposal", "other"],
      ["other-proposal", "proposal", "other", null, null],
      ["other-entity", "user", "proposal", null, null],
      ["deleted-legacy-child", "proposal_review", "deleted-review", null, null],
    ];
    await env.DB.batch(
      entries.map(([id, entityType, entityId, scopeType, scopeId]) =>
        env.DB.prepare(
          `INSERT INTO audit_log
          (id, actor_type, actor_id, action, entity_type, entity_id, scope_type, scope_id, details_json, created_at)
         VALUES (?, 'admin', ?, 'updated', ?, ?, ?, ?, '{"note":"needle"}', ?)`,
        ).bind(id, admin.id, entityType, entityId, scopeType, scopeId, "2026-10-21T00:00:00.000Z"),
      ),
    );

    const all = await listProposalAuditLog(env.DB, "proposal", { limit: 20, offset: 0 });
    expect(all.auditLog.map((entry) => entry.id)).toEqual([
      "legacy-proposal",
      "legacy-review",
      "legacy-speaker",
      "scoped",
      "scoped-deleted-child",
    ]);
    expect(all.page.total).toBe(5);
    const filtered = await listProposalAuditLog(env.DB, "proposal", {
      limit: 1,
      offset: 1,
      q: "needle",
      entityType: "proposal_review",
      actorType: "admin",
      action: "updated",
      sort: "action",
    });
    expect(filtered.page.total).toBe(2);
    expect(filtered.auditLog.map((entry) => entry.id)).toEqual(["scoped-deleted-child"]);
  });

  it("counts each registered attendee once across active days and excludes inactive queue entries", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const timestamp = "2026-10-21T00:00:00.000Z";
    for (const [id, date] of [
      ["day-1", "2026-12-01"],
      ["day-2", "2026-12-02"],
    ]) {
      await env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      )
        .bind(id, eventId, date, timestamp, timestamp)
        .run();
    }
    const registrations = [
      ["multi-day", "registered", "in_person", ["waiting", "offered"]],
      ["inactive-queue", "registered", "in_person", ["accepted", "removed"]],
      ["expired-queue", "registered", "virtual", ["expired"]],
      ["cancelled", "cancelled", "in_person", ["waiting"]],
      ["pending", "pending_email_confirmation", "in_person", ["offered"]],
    ] as const;
    for (const [id, status, attendanceType, queueStatuses] of registrations) {
      const userId = await insertUser(env.DB);
      await env.DB.prepare(
        `INSERT INTO registrations
          (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'admin', ?, ?, ?)`,
      )
        .bind(id, eventId, userId, status, attendanceType, id, timestamp, timestamp)
        .run();
      await env.DB.batch(
        queueStatuses.map((queueStatus, index) =>
          env.DB.prepare(
            `INSERT INTO event_day_waitlist_entries
            (id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'general', ?, 1, ?, ?)`,
          ).bind(`${id}-${index}`, eventId, `day-${index + 1}`, id, userId, queueStatus, timestamp, timestamp),
        ),
      );
    }
    expect(await getAttendanceStatusByType(env.DB, eventId)).toEqual({
      in_person: { accepted: 1, waitlisted: 1 },
      virtual: { accepted: 1, waitlisted: 0 },
    });
    expect(await getAttendanceStatusByType(env.DB, "other-event")).toEqual({});
  });
});
