import { describe, it, expect } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";

describe("members model", () => {
  it("supports individual and organization members with strict subject constraints", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();

    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const individualMemberId = crypto.randomUUID();
    const organizationMemberId = crypto.randomUUID();

    await db.exec(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
      VALUES ('${userId}', 'member@example.test', 'member@example.test', 'Member', 'User', 'PKIC', 'Engineer', NULL, datetime('now'), datetime('now'));

      INSERT INTO organizations (id, name, normalized_name, data_json, created_at, updated_at)
      VALUES ('${organizationId}', 'PKI Org', 'pki-org', NULL, datetime('now'), datetime('now'));

      INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at)
      VALUES ('${individualMemberId}', 'individual', '${userId}', NULL, 'active', 'standard', NULL, datetime('now'), datetime('now'));

      INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at)
      VALUES ('${organizationMemberId}', 'organization', NULL, '${organizationId}', 'active', 'sponsor', NULL, datetime('now'), datetime('now'));
    `);

    const counts = db.raw<{ total: number }>(
      "SELECT COUNT(*) AS total FROM members WHERE member_type IN ('individual', 'organization')",
    )[0];
    expect(Number(counts.total)).toBe(2);

    await expect(
      db.exec(`
        INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
        VALUES ('${crypto.randomUUID()}', 'individual', '${userId}', '${organizationId}', 'active', datetime('now'), datetime('now'));
      `),
    ).rejects.toThrow();

    await expect(
      db.exec(`
        INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
        VALUES ('${crypto.randomUUID()}', 'individual', '${userId}', NULL, 'active', datetime('now'), datetime('now'));
      `),
    ).rejects.toThrow();
  });
});
