/**
 * membership-settings-endpoints.test.ts
 *
 * Canonical system-portal membership workflow settings and category metadata.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { getMembershipSettings, updateMembershipSettings } from "../functions/_lib/services/membership-settings";
import { getMembershipCategory, updateMembershipCategory } from "../functions/_lib/services/membership/categories";
import {
  MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH,
  MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH,
} from "../assets/shared/schemas/membership-categories";
import {
  MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH,
  MEMBERSHIP_WINDOW_DAY_LIMITS,
} from "../assets/shared/schemas/membership-settings";

function requestWithAuth(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    requestWithAuth(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

describe("Membership workflow settings", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "settings-admin-token");
  });

  it("GET returns the seeded defaults", async () => {
    const response = await call(adminToken, "/api/v1/system/membership-settings");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { consultationWindowDays: number; ecReviewWindowDays: number };
    expect(body.consultationWindowDays).toBe(7);
    expect(body.ecReviewWindowDays).toBe(7);
  });

  it("removes the legacy admin membership-settings API", async () => {
    const response = await call(adminToken, "/api/v1/admin/membership-settings");
    expect(response.status).toBe(404);
  });

  it("PATCH updates only the provided fields", async () => {
    const current = await getMembershipSettings(env.DB);
    const response = await call(adminToken, "/api/v1/system/membership-settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: current.revision, consultationWindowDays: 10 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { consultationWindowDays: number; ecReviewWindowDays: number };
    expect(body.consultationWindowDays).toBe(10);
    expect(body.ecReviewWindowDays).toBe(7);

    const rows = await queryAll<{ consultation_window_days: number; updated_by_user_id: string | null }>(
      env.DB,
      "SELECT consultation_window_days, updated_by_user_id FROM membership_settings WHERE id = 'default'",
    );
    expect(rows[0].consultation_window_days).toBe(10);
    expect(rows[0].updated_by_user_id).toBe(adminId);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'membership_settings_updated'",
      ),
    ).toEqual([{ actor_id: adminId }]);
  });

  it("rejects the shared API key because system configuration requires an attributable user", async () => {
    const response = await call(env.ADMIN_API_KEY ?? "test-admin-key", "/api/v1/system/membership-settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: 0, consultationWindowDays: 12 }),
    });
    expect(response.status).toBe(403);
  });

  it("resetDb() does not wipe the singleton settings row (it is system reference data)", async () => {
    const rows = await queryAll(env.DB, "SELECT id FROM membership_settings WHERE id = 'default'");
    expect(rows).toHaveLength(1);
  });

  it("membership:read is sufficient for GET but cannot update configuration", async () => {
    const staffId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'processor@example.test', 'processor@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffId)
      .run();
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'membership:read', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId, adminId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffId, "processor-settings-token");

    const getResponse = await call(staffToken, "/api/v1/system/membership-settings");
    expect(getResponse.status).toBe(200);
    const current = (await getResponse.json()) as { revision: number };

    const patchResponse = await call(staffToken, "/api/v1/system/membership-settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: current.revision, ecReviewWindowDays: 14 }),
    });
    expect(patchResponse.status).toBe(403);
    expect((await getMembershipSettings(env.DB)).ec_review_window_days).toBe(7);
  });

  it("a staff user with an unrelated role is denied", async () => {
    const staffId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'wgchair@example.test', 'wgchair@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffId)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, role_id, context_type, context_id, single_holder_per_context,
          granted_by_user_id, created_at)
       VALUES (?, ?, 'role-group_lead', 'group', '20000000-0000-4000-8000-000000000001', 0,
               ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId, adminId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffId, "wgchair-settings-token");

    const response = await call(staffToken, "/api/v1/system/membership-settings");
    expect(response.status).toBe(403);
  });

  it("updates category presentation and voting policy without exposing structural fields", async () => {
    const current = await getMembershipCategory(env.DB, "H1");
    expect(current).not.toBeNull();

    const response = await call(adminToken, "/api/v1/system/membership-categories/H1", {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: current!.revision,
        label: "Government PKI participants",
        description: "Updated by the membership team.",
        displayOrder: 75,
        isVoting: true,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      category: { code: string; label: string; isIndividual: boolean; isVoting: boolean; revision: number };
    };
    expect(body.category).toMatchObject({
      code: "H1",
      label: "Government PKI participants",
      isIndividual: false,
      isVoting: true,
      revision: current!.revision + 1,
    });
    expect(
      await queryAll<{ action: string; entity_id: string }>(
        env.DB,
        "SELECT action, entity_id FROM audit_log WHERE action = 'membership_category_updated'",
      ),
    ).toEqual([{ action: "membership_category_updated", entity_id: "H1" }]);

    const structuralChange = await call(adminToken, "/api/v1/system/membership-categories/H1", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: body.category.revision, isIndividual: true }),
    });
    expect(structuralChange.status).toBe(400);
  });

  it("enforces the shared settings and category boundaries at the mounted API", async () => {
    const settings = await getMembershipSettings(env.DB);
    for (const invalidSettings of [
      { consultationWindowDays: MEMBERSHIP_WINDOW_DAY_LIMITS.consultationWindowDays.max + 1 },
      { consultationEmailRecipients: "x".repeat(MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH + 1) },
    ]) {
      const response = await call(adminToken, "/api/v1/system/membership-settings", {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: settings.revision, ...invalidSettings }),
      });
      expect(response.status).toBe(400);
    }

    const category = await getMembershipCategory(env.DB, "H4");
    for (const invalidCategory of [
      { label: " " },
      { label: "x".repeat(MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH + 1) },
      { description: "x".repeat(MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH + 1) },
      { displayOrder: -1 },
    ]) {
      const response = await call(adminToken, "/api/v1/system/membership-categories/H4", {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: category!.revision, ...invalidCategory }),
      });
      expect(response.status).toBe(400);
    }
    expect(await getMembershipSettings(env.DB)).toEqual(settings);
    expect(await getMembershipCategory(env.DB, "H4")).toEqual(category);
  });

  it("rejects stale settings and category revisions without partial writes", async () => {
    const settings = await getMembershipSettings(env.DB);
    const first = await call(adminToken, "/api/v1/system/membership-settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: settings.revision, consultationWindowDays: 9 }),
    });
    expect(first.status).toBe(200);
    const stale = await call(adminToken, "/api/v1/system/membership-settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: settings.revision, ecReviewWindowDays: 20 }),
    });
    expect(stale.status).toBe(409);
    expect((await getMembershipSettings(env.DB)).ec_review_window_days).toBe(7);

    const category = await getMembershipCategory(env.DB, "A");
    const categoryFirst = await call(adminToken, "/api/v1/system/membership-categories/A", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: category!.revision, label: "Voting member" }),
    });
    expect(categoryFirst.status).toBe(200);
    const categoryStale = await call(adminToken, "/api/v1/system/membership-categories/A", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: category!.revision, isVoting: false }),
    });
    expect(categoryStale.status).toBe(409);
    expect((await getMembershipCategory(env.DB, "A"))!.isVoting).toBe(true);
  });

  it("rolls back if permission or configuration changes between preflight and the D1 batch", async () => {
    const actor = createUserBackedAuthAdmin({
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
      grants: [],
    });
    const settings = await getMembershipSettings(env.DB);
    const racedSettingsDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE membership_settings SET revision = revision + 1 WHERE id = 'default'").run(),
    );
    await expect(
      updateMembershipSettings(
        racedSettingsDb,
        { expectedRevision: settings.revision, consultationWindowDays: 11 },
        actor,
      ),
    ).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_CONFIGURATION_CHANGED" });
    expect((await getMembershipSettings(env.DB)).consultation_window_days).toBe(7);

    const category = await getMembershipCategory(env.DB, "H2");
    const racedCategoryDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE membership_categories SET revision = revision + 1 WHERE code = 'H2'").run(),
    );
    await expect(
      updateMembershipCategory(racedCategoryDb, actor, "H2", {
        expectedRevision: category!.revision,
        isVoting: true,
      }),
    ).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_CONFIGURATION_CHANGED" });
    expect((await getMembershipCategory(env.DB, "H2"))!.isVoting).toBe(false);

    const authorizedCategory = await getMembershipCategory(env.DB, "H3");
    const revokedCategoryDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(adminId).run(),
    );
    await expect(
      updateMembershipCategory(revokedCategoryDb, actor, "H3", {
        expectedRevision: authorizedCategory!.revision,
        label: "This update must roll back",
      }),
    ).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_CONFIGURATION_AUTHORIZATION_CHANGED" });
    expect((await getMembershipCategory(env.DB, "H3"))!.label).toBe(authorizedCategory!.label);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'membership_category_updated'"),
    ).toHaveLength(0);
  });
});
