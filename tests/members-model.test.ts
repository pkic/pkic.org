import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { queryAll } from "./helpers/context";

describe("members model", () => {
  it("supports individual and organization members with strict subject constraints", async () => {

    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const individualMemberId = crypto.randomUUID();
    const organizationMemberId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
        VALUES ('${userId}', 'member@example.test', 'member@example.test', 'Member', 'User', 'PKIC', 'Engineer', NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO organizations (id, name, normalized_name, data_json, created_at, updated_at)
        VALUES ('${organizationId}', 'PKI Org', 'pki-org', NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at)
        VALUES ('${individualMemberId}', 'individual', '${userId}', NULL, 'active', 'standard', NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at)
        VALUES ('${organizationMemberId}', 'organization', NULL, '${organizationId}', 'active', 'sponsor', NULL, datetime('now'), datetime('now'))
      `),
    ]);

    const counts = ((await queryAll<{ total: number }>(env.DB, 
      "SELECT COUNT(*) AS total FROM members WHERE member_type IN ('individual', 'organization')",
    )))[0];
    expect(Number(counts.total)).toBe(2);

    await expect(
      env.DB.prepare(`
        INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
        VALUES ('${crypto.randomUUID()}', 'individual', '${userId}', '${organizationId}', 'active', datetime('now'), datetime('now'));
      `).run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(`
        INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
        VALUES ('${crypto.randomUUID()}', 'individual', '${userId}', NULL, 'active', datetime('now'), datetime('now'));
      `).run(),
    ).rejects.toThrow();
  });
});
