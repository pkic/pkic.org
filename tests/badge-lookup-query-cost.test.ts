import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { activeReprintableBadgeWhereSql } from "../functions/_lib/services/event-participation/badge-lifecycle";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { resetDb } from "./helpers/reset-db";

const ATTENDEES = 300;
const NOW = "2026-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";
/** The attendee's own registration and badge, never every badge of the event. */
const ROWS_PER_ATTENDEE = 8;

function numbered(select: string): string {
  return `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${ATTENDEES}) ${select}`;
}

describe("badge lookup query cost", () => {
  let eventId: string;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    const stamp = `'${NOW}'`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
         ${numbered(`SELECT 'user-' || i, 'user' || i || '@example.test', 'user' || i || '@example.test', ${stamp}, ${stamp} FROM n`)}`,
      ),
      env.DB.prepare(
        `INSERT INTO registrations (id, event_id, user_id, status, source_type, manage_link_secret, created_at, updated_at)
         ${numbered(`SELECT 'registration-' || i, '${eventId}', 'user-' || i, 'registered', 'direct', 'secret-' || i, ${stamp}, ${stamp} FROM n`)}`,
      ),
      env.DB.prepare(
        `INSERT INTO event_badge_credentials (id, event_id, user_id, credential_hash, print_credential_json, created_at, expires_at)
         ${numbered(`SELECT 'badge-' || i, '${eventId}', 'user-' || i, 'hash-' || i, '{}', ${stamp}, '${FUTURE}' FROM n`)}`,
      ),
    ]);
  });

  it("reads each attendee's own badge instead of every badge of the event", async () => {
    await env.DB.prepare("UPDATE event_badge_credentials SET expires_at = ? WHERE user_id = 'user-1'").bind(NOW).run();
    const profile = profileD1Flow(env.DB, { measureRowsRead: true });

    const rows = await queryAll<{ user_id: string; badge_id: string | null }>(
      profile.db,
      `SELECT r.user_id,
              (SELECT b.id FROM event_badge_credentials b
                WHERE ${activeReprintableBadgeWhereSql("b", "r.event_id", "r.user_id", "?")}
                ORDER BY b.created_at DESC, b.id DESC LIMIT 1) AS badge_id
         FROM registrations r WHERE r.event_id = ?`,
      [new Date().toISOString(), eventId],
    );

    const badges = new Map(rows.map((row) => [row.user_id, row.badge_id]));
    expect(badges.get("user-1")).toBeNull();
    expect(badges.get("user-2")).toBe("badge-2");
    expect(profile.summary().queries[0]?.rowsRead).toBeLessThan(ROWS_PER_ATTENDEE * ATTENDEES);
  });
});
