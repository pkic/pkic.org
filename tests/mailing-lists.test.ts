/**
 * mailing-lists.test.ts
 *
 * managed mailing list configuration and
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
import { resolveAutoSyncListEmails } from "../functions/_lib/services/mailing-list-management/read-model";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

describe("Managed mailing list configuration", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-mailing-lists-token");
    // consolidated migration 0035 seeds 9 lists once at migration time; mailing_lists is
    // excluded from resetDb()'s per-test wipe (tests/helpers/reset-db.ts —
    // same "system reference data" treatment as membership_settings), so
    // pkic@/consultation@ are already present here.
  });

  it("retires the duplicate admin CRUD and on-demand sync routes", async () => {
    const pathsAndMethods: Array<[string, string]> = [
      ["/api/v1/admin/mailing-lists", "GET"],
      ["/api/v1/admin/mailing-lists", "POST"],
      ["/api/v1/admin/mailing-lists/30000000-0000-4000-8000-000000000004", "PATCH"],
      ["/api/v1/admin/mailing-lists/30000000-0000-4000-8000-000000000004", "DELETE"],
    ];
    for (const [path, method] of pathsAndMethods) {
      const response = await call(adminToken, path, {
        method,
        ...(method === "POST" || method === "PATCH"
          ? { body: JSON.stringify({ email: "retired@example.test", label: "Retired", purpose: "custom" }) }
          : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(503);
      await expect(response.json(), `${method} ${path}`).resolves.toMatchObject({
        error: { code: "ADMIN_ROUTE_POLICY_MISSING" },
      });
    }

    const staleSyncRoute = await call(adminToken, "/api/v1/admin/mailing-lists/sync", { method: "POST" });
    expect(staleSyncRoute.status).toBe(503);
    await expect(staleSyncRoute.json()).resolves.toMatchObject({
      error: { code: "ADMIN_ROUTE_POLICY_MISSING" },
    });
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
