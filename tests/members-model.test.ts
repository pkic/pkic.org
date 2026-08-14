import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { queryAll } from "./helpers/context";

describe("members model", () => {
  it("allows multiple representatives per organization and an org-less individual member", async () => {
    const primaryUserId = crypto.randomUUID();
    const secondaryUserId = crypto.randomUUID();
    const individualUserId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const primaryMemberId = crypto.randomUUID();
    const secondaryMemberId = crypto.randomUUID();
    const individualMemberId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
        VALUES ('${primaryUserId}', 'primary@example.test', 'primary@example.test', 'Primary', 'Contact', 'PKI Org', 'Engineer', NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
        VALUES ('${secondaryUserId}', 'secondary@example.test', 'secondary@example.test', 'Secondary', 'Contact', 'PKI Org', 'Manager', NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
        VALUES ('${individualUserId}', 'individual@example.test', 'individual@example.test', 'Solo', 'Member', NULL, NULL, NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO organizations (id, name, normalized_name, data_json, created_at, updated_at)
        VALUES ('${organizationId}', 'PKI Org', 'pki-org', NULL, datetime('now'), datetime('now'))
      `),
      // Two representatives from the same organization — the feature this
      // rebuild enables (previously blocked by UNIQUE(organization_id)).
      env.DB.prepare(`
        INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at)
        VALUES ('${primaryMemberId}', 'A', '${primaryUserId}', '${organizationId}', 'active', 'A', NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at)
        VALUES ('${secondaryMemberId}', 'A', '${secondaryUserId}', '${organizationId}', 'active', 'A', NULL, datetime('now'), datetime('now'))
      `),
      // Individual category (e.g. H5/H6/H7): user_id set, no organization_id.
      env.DB.prepare(`
        INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at)
        VALUES ('${individualMemberId}', 'H6', '${individualUserId}', NULL, 'active', 'H6', NULL, datetime('now'), datetime('now'))
      `),
    ]);

    const counts = (
      await queryAll<{ total: number }>(
        env.DB,
        `SELECT COUNT(*) AS total FROM members WHERE organization_id = '${organizationId}'`,
      )
    )[0];
    expect(Number(counts.total)).toBe(2);

    // user_id is now required on every row.
    await expect(
      env.DB.prepare(
        `
        INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
        VALUES ('${crypto.randomUUID()}', 'A', NULL, '${organizationId}', 'active', datetime('now'), datetime('now'));
      `,
      ).run(),
    ).rejects.toThrow();

    // UNIQUE(user_id) is still enforced: a person has at most one members row.
    await expect(
      env.DB.prepare(
        `
        INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
        VALUES ('${crypto.randomUUID()}', 'A', '${primaryUserId}', '${organizationId}', 'active', datetime('now'), datetime('now'));
      `,
      ).run(),
    ).rejects.toThrow();
  });
});
