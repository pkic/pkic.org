import { createCanonicalVote } from "./helpers/voting";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
/**
 * membership-settings-endpoints.test.ts
 *
 * Canonical membership workflow settings and category metadata.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { getMembershipSettings, updateMembershipSettings } from "../functions/_lib/services/membership-settings";
import {
  getMembershipCategory,
  listMembershipCategories,
  updateMembershipCategory,
} from "../functions/_lib/services/membership/categories";
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

  it("renames a category atomically and retains organization assignments and eligibility", async () => {
    const organizationId = await insertOrganization(env.DB, "Example Organization");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    const current = await getMembershipCategory(env.DB, "A");
    const vote = await createCanonicalVote(
      env.DB,
      createUserBackedAuthAdmin({ id: adminId, email: "admin@pkic.org", role: "admin", grants: [] }),
      { eligibleCategories: ["A", "B"] },
    );
    const beforeRules = await queryAll(
      env.DB,
      "SELECT group_id FROM group_membership_category_rules WHERE membership_category_code = 'A'",
    );
    const response = await call(adminToken, "/api/v1/membership/categories/A", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: current!.revision, code: "ORG", label: "Organization members" }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await getMembershipCategory(env.DB, "A")).toBeNull();
    expect(await getMembershipCategory(env.DB, "ORG")).toMatchObject({
      label: "Organization members",
      revision: current!.revision + 1,
    });
    expect(
      await queryAll(env.DB, "SELECT category_code FROM member_category_assignments WHERE category_code = 'ORG'"),
    ).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT group_id FROM group_membership_category_rules WHERE membership_category_code = 'ORG'",
      ),
    ).toEqual(beforeRules);
    expect(await queryAll(env.DB, "PRAGMA foreign_key_check")).toEqual([]);
    const voteRow = await env.DB.prepare("SELECT eligible_categories, transition_revision FROM votes WHERE id = ?")
      .bind(vote.id)
      .first<{ eligible_categories: string; transition_revision: number }>();
    expect(JSON.parse(voteRow!.eligible_categories)).toEqual(["ORG", "B"]);
    expect(voteRow!.transition_revision).toBeGreaterThan(0);
    const mailing = await queryAll<{ auto_sync_categories_json: string }>(
      env.DB,
      "SELECT auto_sync_categories_json FROM mailing_lists WHERE subscription_default = 'eligible_categories'",
    );
    expect(mailing.some((row) => JSON.parse(row.auto_sync_categories_json).includes("ORG"))).toBe(true);
  });

  it("rejects duplicate codes and stale renames without changing the catalog", async () => {
    const current = await getMembershipCategory(env.DB, "A");
    for (const update of [
      { code: "B", expectedRevision: current!.revision },
      { code: "ORG", expectedRevision: current!.revision + 1 },
    ]) {
      const response = await call(adminToken, "/api/v1/membership/categories/A", {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      expect(response.status).toBe(409);
    }
    expect(await getMembershipCategory(env.DB, "A")).toEqual(current);
    expect(await getMembershipCategory(env.DB, "ORG")).toBeNull();
  });

  it("reorders the complete catalog and rejects stale, incomplete, and duplicate snapshots", async () => {
    const original = await listMembershipCategories(env.DB);
    const categories = [...original].reverse().map(({ code, revision }) => ({ code, expectedRevision: revision }));
    const reorder = (entries: typeof categories) =>
      call(adminToken, "/api/v1/membership/categories/order", {
        method: "PUT",
        body: JSON.stringify({ categories: entries }),
      });
    const response = await reorder(categories);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await listMembershipCategories(env.DB)).map(({ code }) => code)).toEqual(
      categories.map(({ code }) => code),
    );
    expect((await reorder(categories)).status).toBe(409);
    const current = (await listMembershipCategories(env.DB)).map(({ code, revision }) => ({
      code,
      expectedRevision: revision,
    }));
    expect((await reorder(current.slice(1))).status).toBe(409);
    expect((await reorder([...current, current[0]])).status).toBe(400);
    expect((await listMembershipCategories(env.DB)).map(({ code }) => code)).toEqual(
      categories.map(({ code }) => code),
    );
    expect(
      await queryAll(env.DB, "SELECT action FROM audit_log WHERE action = 'membership_categories_reordered'"),
    ).toHaveLength(1);
  });

  it.each([false, true])("creates and deletes an unused category with individual=%s", async (isIndividual) => {
    const created = await call(adminToken, "/api/v1/membership/categories", {
      method: "POST",
      body: JSON.stringify({
        code: "COMMUNITY",
        label: "Community participants",
        description: null,
        displayOrder: 200,
        isVoting: false,
        isIndividual,
        requiresUniversityEmail: isIndividual,
      }),
    });
    expect(created.status).toBe(201);
    const category = await getMembershipCategory(env.DB, "COMMUNITY");
    expect(category).toMatchObject({ isIndividual, requiresUniversityEmail: isIndividual, revision: 0 });
    const deleted = await call(adminToken, "/api/v1/membership/categories/COMMUNITY", {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision: 0 }),
    });
    expect(deleted.status).toBe(200);
    expect(await getMembershipCategory(env.DB, "COMMUNITY")).toBeNull();
    expect(
      await queryAll(env.DB, "SELECT action FROM audit_log WHERE entity_id = 'COMMUNITY' ORDER BY action"),
    ).toEqual([{ action: "membership_category_created" }, { action: "membership_category_deleted" }]);
  });

  it("grants a newly configured individual category and rejects an organization category", async () => {
    const created = await call(adminToken, "/api/v1/membership/categories", {
      method: "POST",
      body: JSON.stringify({
        code: "COMMUNITY",
        label: "Community users",
        description: null,
        displayOrder: 200,
        isVoting: false,
        isIndividual: true,
        requiresUniversityEmail: false,
      }),
    });
    expect(created.status).toBe(201);
    const userId = await insertUser(env.DB, "community-user@example.test");
    const grant = (membershipCategory: string) =>
      call(adminToken, "/api/v1/members/capacities", {
        method: "POST",
        body: JSON.stringify({ userId, membershipCategory, activationReason: "Approved community membership" }),
      });
    expect((await grant("H1")).status).toBe(422);
    expect((await grant("COMMUNITY")).status).toBe(201);
    expect(await queryAll(env.DB, "SELECT member_type FROM members WHERE user_id = ?", [userId])).toEqual([
      { member_type: "individual" },
    ]);
  });

  it("keeps an assigned category and its group rules when deletion is refused", async () => {
    const organization = await insertOrganization(env.DB, "Example community organization");
    await seedOrganizationAggregate(env.DB, organization, "H1");
    const rulesBefore = await queryAll(
      env.DB,
      "SELECT group_id, membership_category_code FROM group_membership_category_rules WHERE membership_category_code = 'H1' ORDER BY group_id",
    );
    const current = await getMembershipCategory(env.DB, "H1");
    const response = await call(adminToken, "/api/v1/membership/categories/H1", {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision: current!.revision }),
    });
    expect(response.status).toBe(409);
    expect(await getMembershipCategory(env.DB, "H1")).toEqual(current);
    expect(
      await queryAll(
        env.DB,
        "SELECT group_id, membership_category_code FROM group_membership_category_rules WHERE membership_category_code = 'H1' ORDER BY group_id",
      ),
    ).toEqual(rulesBefore);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'membership_category_deleted'")).toEqual([]);
  });

  it("preserves categories referenced by a voting proposal", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO vote_proposals
      (id, title, description, vote_type, owner_group_id, proposed_by_user_id, eligible_categories, status, created_at, updated_at)
      VALUES (?, 'Community participation', 'Example proposal for organizations', 'motion',
        '20000000-0000-4000-8000-000000000001', ?, '["H1"]', 'open_for_endorsement', ?, ?)`,
    )
      .bind(crypto.randomUUID(), adminId, now, now)
      .run();
    const category = await getMembershipCategory(env.DB, "H1");
    const response = await call(adminToken, "/api/v1/membership/categories/H1", {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision: category!.revision }),
    });
    expect(response.status).toBe(409);
    expect(await getMembershipCategory(env.DB, "H1")).toEqual(category);
  });

  it("refuses duplicate category codes and stale deletion without changing the catalog", async () => {
    const category = await getMembershipCategory(env.DB, "H1");
    const duplicate = await call(adminToken, "/api/v1/membership/categories", {
      method: "POST",
      body: JSON.stringify({
        code: "H1",
        label: "Duplicate",
        description: null,
        displayOrder: 0,
        isVoting: false,
        isIndividual: true,
        requiresUniversityEmail: false,
      }),
    });
    expect(duplicate.status).toBe(409);
    const stale = await call(adminToken, "/api/v1/membership/categories/H1", {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision: category!.revision + 1 }),
    });
    expect(stale.status).toBe(409);
    expect(await getMembershipCategory(env.DB, "H1")).toEqual(category);
  });

  it("GET returns the seeded defaults", async () => {
    const response = await call(adminToken, "/api/v1/membership/settings");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { onHoldResponseDeadlineDays: number; autoReminderOnHolds: boolean };
    expect(body.onHoldResponseDeadlineDays).toBe(7);
    expect(body.autoReminderOnHolds).toBe(true);
  });

  it("removes the legacy admin membership-settings API", async () => {
    const response = await call(adminToken, "/api/v1/admin/membership-settings");
    expect(response.status).toBe(404);
  });

  it("removes the former System API routes", async () => {
    expect((await call(adminToken, "/api/v1/system/membership-settings")).status).toBe(404);
    expect((await call(adminToken, "/api/v1/system/membership-categories")).status).toBe(404);
  });

  it("PATCH updates only the provided fields", async () => {
    const current = await getMembershipSettings(env.DB);
    const response = await call(adminToken, "/api/v1/membership/settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: current.revision, onHoldResponseDeadlineDays: 10 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { onHoldResponseDeadlineDays: number; autoReminderOnHolds: boolean };
    expect(body.onHoldResponseDeadlineDays).toBe(10);
    expect(body.autoReminderOnHolds).toBe(true);

    const rows = await queryAll<{ on_hold_response_deadline_days: number; updated_by_user_id: string | null }>(
      env.DB,
      "SELECT on_hold_response_deadline_days, updated_by_user_id FROM membership_settings WHERE id = 'default'",
    );
    expect(rows[0].on_hold_response_deadline_days).toBe(10);
    expect(rows[0].updated_by_user_id).toBe(adminId);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'membership_settings_updated'",
      ),
    ).toEqual([{ actor_id: adminId }]);
  });

  it("rejects the shared API key because membership configuration requires an attributable user", async () => {
    const apiKey = env.ADMIN_API_KEY ?? "test-admin-key";
    const settingsResponse = await call(apiKey, "/api/v1/membership/settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: 0, onHoldResponseDeadlineDays: 12 }),
    });
    expect(settingsResponse.status).toBe(403);
    expect((await call(apiKey, "/api/v1/membership/categories")).status).toBe(403);
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

    const getResponse = await call(staffToken, "/api/v1/membership/settings");
    expect(getResponse.status).toBe(200);
    expect((await call(staffToken, "/api/v1/membership/categories")).status).toBe(200);
    const current = (await getResponse.json()) as { revision: number };

    const patchResponse = await call(staffToken, "/api/v1/membership/settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: current.revision, onHoldResponseDeadlineDays: 14 }),
    });
    expect(patchResponse.status).toBe(403);
    const category = await getMembershipCategory(env.DB, "H1");
    const categoryPatchResponse = await call(staffToken, "/api/v1/membership/categories/H1", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: category!.revision, code: "ORG", label: "This must not save" }),
    });
    expect(categoryPatchResponse.status).toBe(403);
    const orderResponse = await call(staffToken, "/api/v1/membership/categories/order", {
      method: "PUT",
      body: JSON.stringify({
        categories: (await listMembershipCategories(env.DB)).map(({ code, revision }) => ({
          code,
          expectedRevision: revision,
        })),
      }),
    });
    expect(orderResponse.status).toBe(403);
    expect(
      (
        await call(staffToken, "/api/v1/membership/categories", {
          method: "POST",
          body: JSON.stringify({
            code: "STAFF_ONLY",
            label: "Staff users",
            description: null,
            displayOrder: 0,
            isVoting: false,
            isIndividual: true,
            requiresUniversityEmail: false,
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(staffToken, "/api/v1/membership/categories/H1", {
          method: "DELETE",
          body: JSON.stringify({ expectedRevision: category!.revision }),
        })
      ).status,
    ).toBe(403);
    expect((await getMembershipSettings(env.DB)).on_hold_response_deadline_days).toBe(7);
    expect((await getMembershipCategory(env.DB, "H1"))!.label).toBe(category!.label);
  });

  it("a staff user with an unrelated role is denied", async () => {
    const staffId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'wgchair@example.test', 'wgchair@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffId)
      .run();
    const { memberId } = await grantGroupLeadershipCapacity(env.DB, "20000000-0000-4000-8000-000000000001", staffId, {
      grantedByUserId: adminId,
    });
    const staffToken = await createAdminSession(env.DB, staffId, "wgchair-settings-token", undefined, memberId);

    const response = await call(staffToken, "/api/v1/membership/settings");
    expect(response.status).toBe(403);
  });

  it("updates category presentation and voting policy without exposing structural fields", async () => {
    const current = await getMembershipCategory(env.DB, "H1");
    expect(current).not.toBeNull();

    const response = await call(adminToken, "/api/v1/membership/categories/H1", {
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

    const structuralChange = await call(adminToken, "/api/v1/membership/categories/H1", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: body.category.revision, isIndividual: true }),
    });
    expect(structuralChange.status).toBe(400);
  });

  it("enforces the shared settings and category boundaries at the mounted API", async () => {
    const settings = await getMembershipSettings(env.DB);
    for (const invalidSettings of [
      { onHoldResponseDeadlineDays: MEMBERSHIP_WINDOW_DAY_LIMITS.onHoldResponseDeadlineDays.max + 1 },
      { consultationEmailRecipients: "x".repeat(MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH + 1) },
    ]) {
      const response = await call(adminToken, "/api/v1/membership/settings", {
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
      const response = await call(adminToken, "/api/v1/membership/categories/H4", {
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
    const first = await call(adminToken, "/api/v1/membership/settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: settings.revision, onHoldResponseDeadlineDays: 9 }),
    });
    expect(first.status).toBe(200);
    const stale = await call(adminToken, "/api/v1/membership/settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: settings.revision, onHoldResponseDeadlineDays: 20 }),
    });
    expect(stale.status).toBe(409);
    expect((await getMembershipSettings(env.DB)).on_hold_response_deadline_days).toBe(9);

    const category = await getMembershipCategory(env.DB, "A");
    const categoryFirst = await call(adminToken, "/api/v1/membership/categories/A", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: category!.revision, label: "Voting member" }),
    });
    expect(categoryFirst.status).toBe(200);
    const categoryStale = await call(adminToken, "/api/v1/membership/categories/A", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: category!.revision, isVoting: false }),
    });
    expect(categoryStale.status).toBe(409);
    expect((await getMembershipCategory(env.DB, "A"))!.isVoting).toBe(true);
  });

  it("rolls back a rename if the category changes before the atomic batch", async () => {
    const actor = createUserBackedAuthAdmin({ id: adminId, email: "admin@pkic.org", role: "admin", grants: [] });
    const category = await getMembershipCategory(env.DB, "A");
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE membership_categories SET revision = revision + 1 WHERE code = 'A'").run(),
    );
    await expect(
      updateMembershipCategory(racedDb, actor, "A", { code: "ORG", expectedRevision: category!.revision }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await getMembershipCategory(env.DB, "ORG")).toBeNull();
    expect(await getMembershipCategory(env.DB, "A")).not.toBeNull();
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'membership_category_updated'"),
    ).toHaveLength(0);
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
        { expectedRevision: settings.revision, onHoldResponseDeadlineDays: 11 },
        actor,
      ),
    ).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_CONFIGURATION_CHANGED" });
    expect((await getMembershipSettings(env.DB)).on_hold_response_deadline_days).toBe(7);

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
