/**
 * mailing-lists.test.ts
 *
 * PRD §4.14 (Phase 4C): managed mailing list configuration, admin CRUD, and
 * the Google Groups sync engine reading auto-sync rules from `mailing_lists`
 * at runtime instead of the PKIC_ALL_MEMBERS_LIST/CONSULTATION_LIST
 * constants membership-onboarding.ts used to hardcode.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resolveAutoSyncListEmails } from "../functions/_lib/services/mailing-lists";
import { signAdminSessionToken } from "../functions/_lib/auth/admin";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { nowIso, addHours } from "../functions/_lib/utils/time";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(request(token, path, init), env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

describe("Managed mailing list configuration (PRD §4.14, Phase 4C)", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1"))[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-mailing-lists-token");
    // migration 0041 seeds 9 lists once at migration time; mailing_lists is
    // excluded from resetDb()'s per-test wipe (tests/helpers/reset-db.ts —
    // same "system reference data" treatment as membership_settings), so
    // pkic@/consultation@ are already present here.
  });

  it("GET /api/v1/admin/mailing-lists returns the seeded lists", async () => {
    const response = await call(adminToken, "/api/v1/admin/mailing-lists");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { mailingLists: Array<{ email: string; listType: string }> };
    const emails = body.mailingLists.map((l) => l.email);
    expect(emails).toContain("pkic@lists.pkic.org");
    expect(emails).toContain("consultation@lists.pkic.org");
  });

  it("POST creates a new mailing list", async () => {
    const response = await call(adminToken, "/api/v1/admin/mailing-lists", {
      method: "POST",
      body: JSON.stringify({ email: "custom@lists.pkic.org", label: "Custom List", listType: "custom" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { mailingList: { id: string; email: string } };
    expect(body.mailingList.email).toBe("custom@lists.pkic.org");

    const rows = await queryAll<{ email: string }>(env.DB, "SELECT email FROM mailing_lists WHERE id = ?", body.mailingList.id);
    expect(rows).toHaveLength(1);
  });

  it("rejects a duplicate email with 409", async () => {
    const response = await call(adminToken, "/api/v1/admin/mailing-lists", {
      method: "POST",
      body: JSON.stringify({ email: "pkic@lists.pkic.org", label: "Duplicate", listType: "custom" }),
    });
    expect(response.status).toBe(409);
  });

  it("PATCH edits a list's label/active state, DELETE removes it", async () => {
    const created = await call(adminToken, "/api/v1/admin/mailing-lists", {
      method: "POST",
      body: JSON.stringify({ email: "temp@lists.pkic.org", label: "Temp", listType: "custom" }),
    });
    const { mailingList } = (await created.json()) as { mailingList: { id: string } };

    const patchResponse = await call(adminToken, `/api/v1/admin/mailing-lists/${mailingList.id}`, {
      method: "PATCH",
      body: JSON.stringify({ label: "Renamed", active: false }),
    });
    expect(patchResponse.status).toBe(200);
    const patchBody = (await patchResponse.json()) as { mailingList: { label: string; active: boolean } };
    expect(patchBody.mailingList.label).toBe("Renamed");
    expect(patchBody.mailingList.active).toBe(false);

    const deleteResponse = await call(adminToken, `/api/v1/admin/mailing-lists/${mailingList.id}`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    const rows = await queryAll<{ id: string }>(env.DB, "SELECT id FROM mailing_lists WHERE id = ?", mailingList.id);
    expect(rows).toHaveLength(0);
  });

  it("rejects a non-admin-role staff user with 403", async () => {
    // createAdminSession (tests/helpers/auth.ts) always signs the full
    // AUTH_SCOPES set as a test-harness convenience, regardless of the
    // user's actual DB role — unlike the real magic-link flow
    // (verifyAdminMagicLink), which sets scopes: [] for any non-admin role.
    // Mailing Lists is gated by that legacy scope system (admin role
    // required, no Phase 2 permission — see admin-mailing-lists.ts's header
    // note), so this test builds the token directly with scopes: [] to
    // exercise the real production behavior for a non-admin role.
    const staffUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffUserId, "staff-ml@example.test", "staff-ml@example.test")
      .run();
    // STAFF_ACCESS_CONDITION (functions/_lib/auth/admin.ts) requires some
    // baseline eligibility to hold a session at all — an unrelated grant,
    // not the one under test.
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, staffUserId)
      .run();

    const sessionId = crypto.randomUUID();
    const rawToken = "unprivileged-mailing-list-token";
    const tokenHash = await sha256Hex(rawToken);
    const now = nowIso();
    const expiresAt = addHours(now, 8);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)`,
    )
      .bind(sessionId, staffUserId, tokenHash, expiresAt, now)
      .run();
    const staffToken = await signAdminSessionToken(env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret", {
      admin: { id: staffUserId, email: "staff-ml@example.test", role: "user", scopes: [] },
      sessionId,
      expiresAt,
      scopes: [],
    });

    const response = await call(staffToken, "/api/v1/admin/mailing-lists");
    expect(response.status).toBe(403);
  });

  it("resolveAutoSyncListEmails returns both lists for a consultation category (A-G), only all_members for H-categories", async () => {
    const votingCategoryEmails = await resolveAutoSyncListEmails(env.DB as any, "A");
    expect(votingCategoryEmails.sort()).toEqual(["consultation@lists.pkic.org", "pkic@lists.pkic.org"].sort());

    const individualCategoryEmails = await resolveAutoSyncListEmails(env.DB as any, "H6");
    expect(individualCategoryEmails).toEqual(["pkic@lists.pkic.org"]);
  });

  it("resolveAutoSyncListEmails ignores an inactive list", async () => {
    await env.DB.prepare("UPDATE mailing_lists SET active = 0 WHERE email = 'consultation@lists.pkic.org'").run();
    const emails = await resolveAutoSyncListEmails(env.DB as any, "A");
    expect(emails).toEqual(["pkic@lists.pkic.org"]);
  });
});
