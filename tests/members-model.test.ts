import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { insertUser, insertOrganization, seedOrganizationAggregate, addRepresentative } from "./helpers/membership";

beforeEach(async () => {
  await resetDb();
});

describe("members model", () => {
  it("one aggregate row per organization, with N representatives attached via organization_representatives", async () => {
    const primaryUserId = await insertUser(env.DB, "primary@example.test");
    const secondaryUserId = await insertUser(env.DB, "secondary@example.test");
    const organizationId = await insertOrganization(env.DB, "PKI Org");

    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, primaryUserId);
    await addRepresentative(env.DB, memberId, secondaryUserId);

    // Exactly one aggregate row per organization — migration 0000's
    // UNIQUE(organization_id) is untouched by this PR.
    const aggregateCount = (
      await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM members WHERE organization_id = ?",
        organizationId,
      )
    )[0];
    expect(Number(aggregateCount.total)).toBe(1);

    // Two representatives from the same organization — organization_representatives
    // is what allows this, not members.
    const repCount = (
      await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM organization_representatives WHERE member_id = ? AND left_at IS NULL",
        memberId,
      )
    )[0];
    expect(Number(repCount.total)).toBe(2);
  });

  it("individual category (org-less): user_id set, no organization_id", async () => {
    const individualUserId = await insertUser(env.DB, "individual@example.test");
    await env.DB.prepare(
      `INSERT INTO members (id, member_type, user_id, status, created_at, updated_at)
         VALUES (?, 'individual', ?, 'active', datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), individualUserId)
      .run();

    const row = (
      await queryAll<{ organization_id: string | null; user_id: string }>(
        env.DB,
        "SELECT organization_id, user_id FROM members WHERE user_id = ?",
        individualUserId,
      )
    )[0];
    expect(row.organization_id).toBeNull();
    expect(row.user_id).toBe(individualUserId);
  });

  it("member_type is a plain individual/organization discriminator, not a category — the CHECK constraint rejects anything else", async () => {
    const userId = await insertUser(env.DB);
    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, user_id, status, created_at, updated_at)
           VALUES (?, 'A', ?, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), userId)
        .run(),
    ).rejects.toThrow();
  });

  it("organization-type rows must have organization_id set and user_id NULL (mutual exclusivity CHECK)", async () => {
    const organizationId = await insertOrganization(env.DB);
    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
           VALUES (?, 'organization', NULL, NULL, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID())
        .run(),
    ).rejects.toThrow();

    // Sanity: the valid form succeeds.
    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
           VALUES (?, 'organization', NULL, ?, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), organizationId)
        .run(),
    ).resolves.toBeDefined();
  });

  it("UNIQUE(organization_id) is still enforced: an organization has at most one aggregate row", async () => {
    const organizationId = await insertOrganization(env.DB);
    await seedOrganizationAggregate(env.DB, organizationId, "A");

    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
           VALUES (?, 'organization', NULL, ?, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), organizationId)
        .run(),
    ).rejects.toThrow();
  });

  it("UNIQUE(user_id) is still enforced: a person has at most one individual aggregate row", async () => {
    const userId = await insertUser(env.DB);
    await env.DB.prepare(
      `INSERT INTO members (id, member_type, user_id, status, created_at, updated_at)
         VALUES (?, 'individual', ?, 'active', datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId)
      .run();

    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, user_id, status, created_at, updated_at)
           VALUES (?, 'individual', ?, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), userId)
        .run(),
    ).rejects.toThrow();
  });
});
