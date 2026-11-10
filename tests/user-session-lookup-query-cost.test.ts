import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resolveEligibleMembershipRows } from "../functions/_lib/auth/identity-capacities";
import { SESSION_ACTING_IDENTITY_MEMBERSHIP_SQL } from "../functions/_lib/auth/session-acting-identities";
import { prepareUserSessionClaimsBatch } from "../functions/_lib/auth/user-session-live-data";
import type { UserSessionTokenClaims } from "../functions/_lib/auth/user-session-token";
import { queryAll } from "./helpers/context";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { resetDb } from "./helpers/reset-db";

const MEMBERS = 400;
const NOW = "2026-01-01T00:00:00.000Z";
/** All six statements of one person's live context: their own rows, never the whole membership. */
const ROWS_PER_PERSON = 60;

function numbered(select: string): string {
  return `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${MEMBERS}) ${select}`;
}

/** Odd members hold an individual membership, even members represent their own organization. */
async function seedMembers(): Promise<void> {
  const stamp = `'${NOW}'`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, active, created_at, updated_at)
       ${numbered(`SELECT 'user-' || i, 'user' || i || '@example.test', 'user' || i || '@example.test', 'U', 1, ${stamp}, ${stamp} FROM n`)}`,
    ),
    env.DB.prepare(
      `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
       ${numbered(`SELECT 'org-' || i, 'Org ' || i, 'org ' || i, ${stamp}, ${stamp} FROM n WHERE i % 2 = 0`)}`,
    ),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, show_on_organization_profile, invited_at, started_at, created_at, updated_at)
       ${numbered(`SELECT 'identity-' || i, 'user-' || i, CASE WHEN i % 2 = 0 THEN 'org-' || i END, 'staff', i % 2 = 0, ${stamp}, ${stamp}, ${stamp}, ${stamp} FROM n`)}`,
    ),
    env.DB.prepare(
      `INSERT INTO members (id, member_type, identity_id, organization_id, status, created_at, updated_at)
       ${numbered(
         `SELECT 'member-' || i, CASE WHEN i % 2 = 0 THEN 'organization' ELSE 'individual' END,
                 CASE WHEN i % 2 = 1 THEN 'identity-' || i END, CASE WHEN i % 2 = 0 THEN 'org-' || i END,
                 'active', ${stamp}, ${stamp} FROM n`,
       )}`,
    ),
    env.DB.prepare(
      `INSERT INTO member_category_assignments (member_id, category_code, created_at, updated_at)
       ${numbered(`SELECT 'member-' || i, 'A', ${stamp}, ${stamp} FROM n`)}`,
    ),
  ]);
}

function insertIdentity(id: string, userId: string, organizationId: string | null) {
  return env.DB.prepare(
    `INSERT INTO identities (id, user_id, organization_id, source, invited_at, started_at, created_at, updated_at)
     VALUES (?, ?, ?, 'staff', '${NOW}', '${NOW}', '${NOW}', '${NOW}')`,
  ).bind(id, userId, organizationId);
}

async function rowsReadForPeople(count: number): Promise<number> {
  const profile = profileD1Flow(env.DB, { measureRowsRead: true });
  const claims = Array.from(
    { length: count },
    (_, index) => ({ sub: `user-${index + 1}`, sid: `session-${index + 1}` }) as UserSessionTokenClaims,
  );
  await profile.db.batch(prepareUserSessionClaimsBatch(profile.db, claims).statements);
  return profile.summary().queries.reduce((total, query) => total + (query.rowsRead ?? 0), 0);
}

describe("user session lookup query cost", () => {
  beforeEach(async () => {
    await resetDb();
    await seedMembers();
  });

  it.each([1, 100])("reads only the rows of the %i people looked up", async (people) => {
    expect(await rowsReadForPeople(people)).toBeLessThan(ROWS_PER_PERSON * people);
  });

  it("reads the same acting membership as the capacity view", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE members SET status = 'lapsed' WHERE id IN ('member-1', 'member-2')"),
      env.DB.prepare(`INSERT INTO users (id, email, normalized_email, first_name, active, created_at, updated_at)
        VALUES ('user-extra', 'extra@example.test', 'extra@example.test', 'U', 1, '${NOW}', '${NOW}')`),
      insertIdentity("identity-second-representative", "user-extra", "org-4"),
      insertIdentity("identity-without-member", "user-3", "org-2"),
      env.DB.prepare("DELETE FROM member_category_assignments WHERE member_id = 'member-6'"),
    ]);
    const read = (membershipSql: string) =>
      queryAll<{ id: string; membership: string | null }>(
        env.DB,
        `SELECT identity.id, ${membershipSql} AS membership FROM identities identity ORDER BY identity.id`,
      );

    const fromView = await read(`(SELECT capacity.membership_category
      FROM identity_member_capacities capacity
      JOIN membership_categories category ON category.code = capacity.membership_category
      WHERE capacity.identity_id = identity.id AND capacity.member_status = 'active'
      ORDER BY category.display_order, category.code LIMIT 1)`);

    expect(await read(SESSION_ACTING_IDENTITY_MEMBERSHIP_SQL)).toEqual(fromView);
    const held = new Map(fromView.map((row) => [row.id, row.membership]));
    expect(held.get("identity-1")).toBeNull();
    expect(held.get("identity-2")).toBeNull();
    expect(held.get("identity-6")).toBeNull();
    expect(held.get("identity-second-representative")).toBe("A");
    expect(held.get("identity-5")).toBe("A");
  });

  it("returns individual and organization memberships, and an organization replaces an individual one", async () => {
    await expect(resolveEligibleMembershipRows(env.DB, "user-1")).resolves.toMatchObject([
      { member_id: "member-1", identity_id: "identity-1", organization_id: null, organization_name: null },
    ]);
    await expect(resolveEligibleMembershipRows(env.DB, "user-2")).resolves.toMatchObject([
      { member_id: "member-2", identity_id: "identity-2", organization_id: "org-2", organization_name: "Org 2" },
    ]);

    await insertIdentity("identity-also-represents", "user-1", "org-2").run();

    await expect(resolveEligibleMembershipRows(env.DB, "user-1")).resolves.toMatchObject([
      { member_id: "member-2", identity_id: "identity-also-represents", organization_id: "org-2" },
    ]);
  });
});
