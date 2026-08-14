/**
 * wg-chair-digest.test.ts
 *
 * Weekly WG chair/vice-chair membership-change digest
 * (functions/_lib/services/wg-chair-digest.ts), added per 2026-07-31
 * manual-testing feedback. Called directly as a service function rather
 * than through HTTP, matching how it runs — cron-triggered (see
 * functions/router.ts's WG_CHAIR_DIGEST_CRON), same convention
 * membership-scheduled-jobs.test.ts already uses for its batch jobs.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { runWeeklyWgChairDigest } from "../functions/_lib/services/wg-chair-digest";

async function insertWorkingGroup(name: string, slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO working_groups (id, name, slug, description, mailing_list_email, active, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, name, slug)
    .run();
  return id;
}

async function insertUser(email: string, notificationPreferencesJson: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, notification_preferences_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email, "First", "Last", notificationPreferencesJson)
    .run();
  return id;
}

async function assignChair(
  userId: string,
  wgId: string,
  roleId: "role-wg_chair" | "role-wg_vice_chair",
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, created_at)
     VALUES (?, ?, ?, 'working_group', ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, roleId, wgId)
    .run();
}

async function insertMembershipRow(
  wgId: string,
  userId: string,
  joinedAtIso: string,
  leftAtIso: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), wgId, userId, joinedAtIso, leftAtIso)
    .run();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe("Weekly WG chair membership-change digest", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("emails the chair when a member joined within the past week, and skips WGs with no changes", async () => {
    const wgWithChange = await insertWorkingGroup("Chaired WG", "chaired-wg");
    const wgWithoutChange = await insertWorkingGroup("Quiet WG", "quiet-wg");
    const chairId = await insertUser("chair@example.test");
    await assignChair(chairId, wgWithChange, "role-wg_chair");
    await assignChair(chairId, wgWithoutChange, "role-wg_chair");

    const joinerId = await insertUser("joiner@example.test");
    await insertMembershipRow(wgWithChange, joinerId, daysAgoIso(1), null);

    const result = await runWeeklyWgChairDigest(env.DB, env as any);
    expect(result.workingGroupsWithChanges).toBe(1);
    expect(result.emailsSent).toBe(1);

    const outbox = await queryAll<{ recipient_email: string; payload_json: string }>(
      env.DB,
      "SELECT recipient_email, payload_json FROM email_outbox WHERE template_key = 'wg-chair-membership-digest'",
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].recipient_email).toBe("chair@example.test");
    const payload = JSON.parse(outbox[0].payload_json) as { joined: Array<{ name: string }>; left: unknown[] };
    expect(payload.joined).toHaveLength(1);
    expect(payload.joined[0].name).toBe("First Last");
    expect(payload.left).toHaveLength(0);
  });

  it("includes both joins and leaves from the same week in one digest, and excludes changes older than 7 days", async () => {
    const wgId = await insertWorkingGroup("Busy WG", "busy-wg");
    const chairId = await insertUser("chair2@example.test");
    await assignChair(chairId, wgId, "role-wg_chair");

    const recentJoinerId = await insertUser("recent-joiner@example.test");
    await insertMembershipRow(wgId, recentJoinerId, daysAgoIso(2), null);

    const recentLeaverId = await insertUser("recent-leaver@example.test");
    await insertMembershipRow(wgId, recentLeaverId, daysAgoIso(30), daysAgoIso(3));

    const staleLeaverId = await insertUser("stale-leaver@example.test");
    await insertMembershipRow(wgId, staleLeaverId, daysAgoIso(60), daysAgoIso(10));

    const result = await runWeeklyWgChairDigest(env.DB, env as any);
    expect(result.emailsSent).toBe(1);

    const outbox = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'wg-chair-membership-digest'",
    );
    const payload = JSON.parse(outbox[0].payload_json) as {
      joined: Array<{ name: string }>;
      left: Array<{ name: string }>;
    };
    expect(payload.joined).toHaveLength(1);
    expect(payload.left).toHaveLength(1);
  });

  it("skips a chair who opted out, but still emails the vice chair", async () => {
    const wgId = await insertWorkingGroup("Opted Out WG", "opted-out-wg");
    const chairId = await insertUser(
      "opted-out-chair@example.test",
      JSON.stringify({ wgChairMembershipDigest: false }),
    );
    const viceChairId = await insertUser("vice-chair@example.test");
    await assignChair(chairId, wgId, "role-wg_chair");
    await assignChair(viceChairId, wgId, "role-wg_vice_chair");

    const joinerId = await insertUser("joiner2@example.test");
    await insertMembershipRow(wgId, joinerId, daysAgoIso(1), null);

    const result = await runWeeklyWgChairDigest(env.DB, env as any);
    expect(result.emailsSent).toBe(1);

    const outbox = await queryAll<{ recipient_email: string }>(
      env.DB,
      "SELECT recipient_email FROM email_outbox WHERE template_key = 'wg-chair-membership-digest'",
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].recipient_email).toBe("vice-chair@example.test");
  });

  it("counts a working group with changes even when it has no chair assigned, but sends no email", async () => {
    const wgId = await insertWorkingGroup("Chairless WG", "chairless-wg");
    const joinerId = await insertUser("joiner3@example.test");
    await insertMembershipRow(wgId, joinerId, daysAgoIso(1), null);

    const result = await runWeeklyWgChairDigest(env.DB, env as any);
    expect(result.workingGroupsWithChanges).toBe(1);
    expect(result.emailsSent).toBe(0);

    const outbox = await queryAll(
      env.DB,
      "SELECT id FROM email_outbox WHERE template_key = 'wg-chair-membership-digest'",
    );
    expect(outbox).toHaveLength(0);
  });

  it("does nothing when there are no working groups with changes", async () => {
    await insertWorkingGroup("Idle WG", "idle-wg");
    const result = await runWeeklyWgChairDigest(env.DB, env as any);
    expect(result).toEqual({ workingGroupsWithChanges: 0, emailsSent: 0 });
  });
});
