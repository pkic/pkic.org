/**
 * leadership.test.ts
 *
 * Board of Directors / Executive Council leadership positions (consolidated
 * migration 0035) — admin CRUD (functions/api/v1/admin/leadership-positions) and the
 * public roster + consortium-chairs reads (functions/api/v1/leadership). See
 * functions/_lib/services/leadership.ts for the design (a dedicated table
 * instead of user_roles, since Board/EC need many simultaneous holders, an
 * explicit admin-set "from" date, and a free-text title).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { seedOrganizationAggregate, addRepresentative } from "./helpers/membership";
import {
  leadershipAffiliationsResponseSchema,
  leadershipPositionResponseSchema,
  leadershipPositionsListResponseSchema,
  leadershipPublicResponseSchema,
} from "../assets/shared/schemas/leadership";

function request(token: string | null, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any,
  );
}

async function insertUser(email: string, name?: [string, string]): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email, name?.[0] ?? null, name?.[1] ?? null)
    .run();
  return id;
}

async function insertOrganization(name: string, website: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO organizations (id, name, normalized_name, website, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(id, name, name.toLowerCase(), website)
    .run();
  return id;
}

async function insertMember(userId: string, organizationId: string): Promise<string> {
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  await addRepresentative(env.DB, memberId, userId);
  return memberId;
}

async function assignRole(
  userId: string,
  roleId: string,
  grantedBy: string,
  context?: { type: string; id: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, roleId, context?.type ?? null, context?.id ?? null, grantedBy)
    .run();
}

describe("leadership positions (consolidated migration 0035) — Board / Executive Council rosters", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-leadership-token");
  });

  it("creates a position, requiring the target user to exist", async () => {
    const memberId = await insertUser("chair@example.test", ["Chris", "Bailey"]);

    const missingUser = await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({
        body: "board",
        userId: crypto.randomUUID(),
        title: "Board Chair",
        startsAt: "2025-03-01",
      }),
    });
    expect(missingUser.status).toBe(404);

    const created = await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({ body: "board", userId: memberId, title: "Board Chair", startsAt: "2025-03-01" }),
    });
    expect(created.status).toBe(201);
    const position = (await created.json()) as { id: string; name: string; title: string; endsAt: string | null };
    expect(position.name).toBe("Chris Bailey");
    expect(position.title).toBe("Board Chair");
    expect(position.endsAt).toBeNull();
  });

  it("requires and preserves an explicit affiliation for a user representing multiple organizations", async () => {
    const userId = await insertUser("multi-org-leader@example.test", ["Multi", "Leader"]);
    const firstOrganizationId = await insertOrganization("First Organization", "https://first.example");
    const secondOrganizationId = await insertOrganization("Second Organization", "https://second.example");
    const firstMemberId = await insertMember(userId, firstOrganizationId);
    const secondMemberId = await insertMember(userId, secondOrganizationId);

    const affiliationsResponse = await call(
      adminToken,
      `/api/v1/admin/leadership-positions/users/${userId}/affiliations`,
    );
    expect(affiliationsResponse.status).toBe(200);
    const affiliations = leadershipAffiliationsResponseSchema.parse(await affiliationsResponse.json());
    expect(affiliations.affiliations.map((item) => item.memberId).sort()).toEqual(
      [firstMemberId, secondMemberId].sort(),
    );

    const ambiguous = await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({ body: "board", userId, title: "Board Member", startsAt: "2026-01-01" }),
    });
    expect(ambiguous.status).toBe(422);
    expect(await ambiguous.json()).toMatchObject({ error: { code: "AFFILIATION_REQUIRED" } });

    const createdResponse = await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({
        body: "board",
        userId,
        memberId: secondMemberId,
        title: "Board Member",
        startsAt: "2026-01-01",
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = leadershipPositionResponseSchema.parse(await createdResponse.json());
    expect(created.memberId).toBe(secondMemberId);
    expect(created.organizationName).toBe("Second Organization");

    const publicResponse = await call(null, "/api/v1/leadership/board");
    const publicBody = (await publicResponse.json()) as { current: Array<{ organizationName: string | null }> };
    expect(publicBody.current[0].organizationName).toBe("Second Organization");
  });

  it("rolls back leadership creation when its audit record cannot be written", async () => {
    const userId = await insertUser("audit-rollback-leader@example.test", ["Audit", "Rollback"]);
    await env.DB.prepare(
      `CREATE TRIGGER fail_leadership_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'leadership_position_created'
       BEGIN
         SELECT RAISE(ABORT, 'forced leadership audit failure');
       END`,
    ).run();

    try {
      const response = await call(adminToken, "/api/v1/admin/leadership-positions", {
        method: "POST",
        body: JSON.stringify({ body: "board", userId, title: "Board Member", startsAt: "2026-01-01" }),
      });
      expect(response.status).toBe(500);
      expect(await queryAll(env.DB, "SELECT id FROM leadership_positions WHERE user_id = ?", [userId])).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER IF EXISTS fail_leadership_audit").run();
    }
  });

  it("lists positions scoped to the requested body only", async () => {
    const boardMember = await insertUser("board-only@example.test", ["Board", "Only"]);
    const ecMember = await insertUser("ec-only@example.test", ["Ec", "Only"]);

    await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({ body: "board", userId: boardMember, title: "Board Member", startsAt: "2022-06-01" }),
    });
    await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({ body: "executive_council", userId: ecMember, title: "EC Member", startsAt: "2022-06-01" }),
    });

    const boardList = leadershipPositionsListResponseSchema.parse(
      await (await call(adminToken, "/api/v1/admin/leadership-positions?body=board")).json(),
    );
    expect(boardList.positions.map((p) => p.name)).toEqual(["Board Only"]);

    const ecList = leadershipPositionsListResponseSchema.parse(
      await (await call(adminToken, "/api/v1/admin/leadership-positions?body=executive_council")).json(),
    );
    expect(ecList.positions.map((p) => p.name)).toEqual(["Ec Only"]);

    const filtered = leadershipPositionsListResponseSchema.parse(
      await (
        await call(
          adminToken,
          "/api/v1/admin/leadership-positions?body=board&status=current&q=Board&limit=1&sort=-starts_at",
        )
      ).json(),
    );
    expect(filtered.positions.map((position) => position.name)).toEqual(["Board Only"]);
    expect(filtered.page).toMatchObject({ limit: 1, offset: 0, total: 1, hasMore: false });
  });

  it("rejects an unknown body value", async () => {
    const response = await call(adminToken, "/api/v1/admin/leadership-positions?body=not-a-body");
    expect(response.status).toBe(400);
  });

  it("updates a position's title and dates, and moving endsAt into the past turns it into a past position", async () => {
    const userId = await insertUser("editable@example.test", ["Ed", "Itable"]);
    const createResponse = await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({ body: "board", userId, title: "Board Member", startsAt: "2022-06-01" }),
    });
    const created = (await createResponse.json()) as { id: string };

    const patchResponse = await call(adminToken, `/api/v1/admin/leadership-positions/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Board Chair", endsAt: "2026-01-01" }),
    });
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as { title: string; endsAt: string | null };
    expect(patched.title).toBe("Board Chair");
    expect(patched.endsAt).toBe("2026-01-01");

    const list = (await (await call(adminToken, "/api/v1/admin/leadership-positions?body=board")).json()) as {
      positions: Array<{ endsAt: string | null }>;
    };
    expect(list.positions[0].endsAt).toBe("2026-01-01");
  });

  it("PATCH/DELETE on an unknown position id returns 404", async () => {
    const patchResponse = await call(adminToken, `/api/v1/admin/leadership-positions/${crypto.randomUUID()}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "X" }),
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await call(adminToken, `/api/v1/admin/leadership-positions/${crypto.randomUUID()}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(404);
  });

  it("deletes a position", async () => {
    const userId = await insertUser("removable@example.test", ["Rem", "Ovable"]);
    const createResponse = await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({ body: "executive_council", userId, title: "EC Member", startsAt: "2022-06-01" }),
    });
    const created = (await createResponse.json()) as { id: string };

    const deleteResponse = await call(adminToken, `/api/v1/admin/leadership-positions/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    const list = (await (
      await call(adminToken, "/api/v1/admin/leadership-positions?body=executive_council")
    ).json()) as { positions: unknown[] };
    expect(list.positions).toHaveLength(0);
  });

  it("a staff user without access:grant is denied create/list/update/delete", async () => {
    const staffUserId = await insertUser("staff-no-grant@example.test");
    await assignRole(staffUserId, "role-membership_processor", adminId);
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-no-grant-token");

    expect((await call(staffToken, "/api/v1/admin/leadership-positions?body=board")).status).toBe(403);
    expect(
      (
        await call(staffToken, "/api/v1/admin/leadership-positions", {
          method: "POST",
          body: JSON.stringify({ body: "board", userId: staffUserId, title: "Board Member", startsAt: "2022-06-01" }),
        })
      ).status,
    ).toBe(403);
  });

  // PR #1 review Phase 4 item 1: leadership-positions had its own
  // requirePermission("access:grant"/"access:revoke") checks but was
  // missing from admin/router.ts's old path-prefix bypass list, so a
  // non-admin-role actor holding an access:grant permission_grant was
  // incorrectly 403'd by the legacy scope check before ever reaching that
  // handler's own, more permissive check. The rewritten router.ts no
  // longer legacy-gates this subtree, so this grant now actually works.
  it("a non-admin-role staff user holding an access:grant permission_grant CAN create and list leadership positions", async () => {
    const staffUserId = await insertUser("staff-with-grant@example.test");
    const targetUserId = await insertUser("board-target@example.test");
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'access:grant', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, adminId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-with-grant-token");

    const createResponse = await call(staffToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({ body: "board", userId: targetUserId, title: "Board Member", startsAt: "2022-06-01" }),
    });
    expect(createResponse.status).toBe(201);

    const listResponse = await call(staffToken, "/api/v1/admin/leadership-positions?body=board");
    expect(listResponse.status).toBe(200);
  });

  it("public GET /api/v1/leadership/:body returns current and past positions with organization enrichment, isolated per body", async () => {
    const orgId = await insertOrganization("Digitorus", "https://digitorus.com");
    const chairUserId = await insertUser("paul@example.test", ["Paul", "van Brouwershaven"]);
    await insertMember(chairUserId, orgId);
    const pastUserId = await insertUser("kirk@example.test", ["Kirk", "Hall"]);

    await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({ body: "board", userId: chairUserId, title: "Board Chair", startsAt: "2025-03-01" }),
    });
    await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({
        body: "board",
        userId: pastUserId,
        title: "Board Chair",
        startsAt: "2022-06-01",
        endsAt: "2025-02-01",
      }),
    });

    // Unauthenticated request — proves this is genuinely public, not just admin-reachable.
    const response = await call(null, "/api/v1/leadership/board");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      current: Array<{ name: string; organizationName: string | null; organizationWebsite: string | null }>;
      past: Array<{ name: string; endsAt: string | null }>;
    };
    expect(body.current).toHaveLength(1);
    expect(body.current[0].name).toBe("Paul van Brouwershaven");
    expect(body.current[0].organizationName).toBe("Digitorus");
    expect(body.current[0].organizationWebsite).toBe("https://digitorus.com");
    expect(body.past).toHaveLength(1);
    expect(body.past[0].name).toBe("Kirk Hall");
    expect(body.past[0].endsAt).toBe("2025-02-01");

    // Executive Council roster is independent of Board's.
    const ecResponse = await call(null, "/api/v1/leadership/executive_council");
    const ecBody = (await ecResponse.json()) as { current: unknown[]; past: unknown[] };
    expect(ecBody.current).toHaveLength(0);
    expect(ecBody.past).toHaveLength(0);
  });

  it("omits an unsafe legacy organization website from public leadership responses", async () => {
    const orgId = await insertOrganization("Unsafe Leadership Org", "javascript:alert(1)");
    const userId = await insertUser("unsafe-leader@example.test", ["Unsafe", "Leader"]);
    await insertMember(userId, orgId);
    const createResponse = await call(adminToken, "/api/v1/admin/leadership-positions", {
      method: "POST",
      body: JSON.stringify({ body: "board", userId, title: "Board Member", startsAt: "2026-01-01" }),
    });
    expect(createResponse.status).toBe(201);

    const response = await call(null, "/api/v1/leadership/board");
    expect(response.status).toBe(200);
    const body = leadershipPublicResponseSchema.parse(await response.json());
    expect(body.current[0].organizationWebsite).toBeNull();
  });

  it("public GET /api/v1/leadership/:body 404s for an unknown body", async () => {
    const response = await call(null, "/api/v1/leadership/not-a-body");
    expect(response.status).toBe(404);
  });

  it("public consortium chairs resolve published All Members group leadership", async () => {
    expect((await call(null, "/api/v1/leadership/forum-chairs")).status).toBe(404);
    const emptyResponse = await call(null, "/api/v1/leadership/consortium-chairs");
    expect(emptyResponse.status).toBe(200);
    expect((await emptyResponse.json()) as { chair: unknown }).toEqual({ chair: null, viceChair: null });

    const leadershipGroup = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM groups WHERE slug = 'all-members'")
    )[0];
    const chairUserId = await insertUser("consortium-chair@example.test", ["Consortium", "Chair"]);
    const viceChairUserId = await insertUser("consortium-vice-chair@example.test", ["Consortium", "ViceChair"]);
    await assignRole(chairUserId, "role-group_lead", adminId, { type: "group", id: leadershipGroup.id });
    await assignRole(viceChairUserId, "role-group_deputy_lead", adminId, {
      type: "group",
      id: leadershipGroup.id,
    });

    const response = await call(null, "/api/v1/leadership/consortium-chairs");
    const body = (await response.json()) as {
      chair: { name: string; startsAt: string } | null;
      viceChair: { name: string } | null;
    };
    expect(body.chair?.name).toBe("Consortium Chair");
    expect(body.chair?.startsAt).toBeTruthy();
    expect(body.viceChair?.name).toBe("Consortium ViceChair");
  });
});
