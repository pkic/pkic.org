import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import {
  insertUser,
  insertOrganization,
  seedOrganizationAggregate,
  addRepresentative,
  insertIndividualMember,
} from "./helpers/membership";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { MEMBER_STATUSES } from "../assets/shared/schemas/membership-categories";

beforeEach(async () => {
  await resetDb();
});

/** A started personal identity that holds no membership yet. */
async function insertPersonalIdentity(): Promise<string> {
  const userId = await insertUser(env.DB);
  const identity = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId: null,
    source: "staff",
    startImmediately: true,
  });
  await identity.statement.run();
  return identity.identityId;
}

function insertIndividualRow(identityId: string | null, status = "active") {
  return env.DB.prepare(
    `INSERT INTO members (id, member_type, identity_id, status, created_at, updated_at)
     VALUES (?, 'individual', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(crypto.randomUUID(), identityId, status)
    .run();
}

describe("members model", () => {
  it("keeps one aggregate row per organization with multiple active identities", async () => {
    const primaryUserId = await insertUser(env.DB, "primary@example.test");
    const secondaryUserId = await insertUser(env.DB, "secondary@example.test");
    const organizationId = await insertOrganization(env.DB, "PKI Org");

    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, primaryUserId);
    await addRepresentative(env.DB, memberId, secondaryUserId);

    const aggregateCount = (
      await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM members WHERE organization_id = ?",
        organizationId,
      )
    )[0];
    expect(Number(aggregateCount.total)).toBe(1);

    // Two acting identities from the same organization attach to that one aggregate.
    const repCount = (
      await queryAll<{ total: number }>(
        env.DB,
        `SELECT COUNT(*) AS total
           FROM identities identity
           JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
          WHERE capacity.member_id = ? AND identity.ended_at IS NULL AND identity.blocked_at IS NULL`,
        memberId,
      )
    )[0];
    expect(Number(repCount.total)).toBe(2);
  });

  it("an individual membership is held by a personal identity and has no user column", async () => {
    const member = await insertIndividualMember(env.DB);
    const row = (
      await queryAll<{ organization_id: string | null; identity_id: string }>(
        env.DB,
        "SELECT organization_id, identity_id FROM members WHERE id = ?",
        member.memberId,
      )
    )[0];
    expect(row).toEqual({ organization_id: null, identity_id: member.identityId });
    const columns = await queryAll<{ name: string }>(env.DB, "SELECT name FROM pragma_table_info('members')");
    expect(columns.map((column) => column.name)).not.toContain("user_id");
    const capacity = await queryAll<{ identity_id: string; user_id: string }>(
      env.DB,
      "SELECT identity_id, user_id FROM identity_member_capacities WHERE member_id = ?",
      member.memberId,
    );
    expect(capacity).toEqual([{ identity_id: member.identityId, user_id: member.userId }]);
  });

  it("member_type is a plain individual/organization discriminator, not a category — the CHECK constraint rejects anything else", async () => {
    const identityId = await insertPersonalIdentity();
    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, identity_id, status, created_at, updated_at)
           VALUES (?, 'A', ?, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), identityId)
        .run(),
    ).rejects.toThrow();
  });

  it("an individual row needs a holding identity and an organization row needs an organization", async () => {
    await expect(insertIndividualRow(null)).rejects.toThrow("members_holder");
    const organizationId = await insertOrganization(env.DB);
    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at)
           VALUES (?, 'organization', NULL, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID())
        .run(),
    ).rejects.toThrow("members_holder");
    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at)
           VALUES (?, 'organization', ?, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), organizationId)
        .run(),
    ).resolves.toBeDefined();
  });

  it("only a personal identity can hold an individual membership", async () => {
    const userId = await insertUser(env.DB);
    const organizationId = await insertOrganization(env.DB);
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    const affiliation = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId,
      source: "staff",
      startImmediately: true,
    });
    await affiliation.statement.run();
    await expect(insertIndividualRow(affiliation.identityId)).rejects.toThrow("MEMBER_IDENTITY_INVALID");
  });

  it("UNIQUE(organization_id) is still enforced: an organization has at most one aggregate row", async () => {
    const organizationId = await insertOrganization(env.DB);
    await seedOrganizationAggregate(env.DB, organizationId, "A");

    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at)
           VALUES (?, 'organization', ?, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), organizationId)
        .run(),
    ).rejects.toThrow();
  });

  it("an identity holds at most one membership, and a membership never moves to another holder", async () => {
    const member = await insertIndividualMember(env.DB);
    await expect(insertIndividualRow(member.identityId)).rejects.toThrow();
    const other = await insertPersonalIdentity();
    await expect(
      env.DB.prepare("UPDATE members SET identity_id = ? WHERE id = ?").bind(other, member.memberId).run(),
    ).rejects.toThrow("MEMBER_HOLDER_IMMUTABLE");
  });

  // members.status has a DB-level CHECK constraint mirroring the canonical
  // MEMBER_STATUSES shared constant; this keeps the two in sync.
  it("members.status CHECK constraint accepts exactly the canonical MEMBER_STATUSES values", async () => {
    for (const status of MEMBER_STATUSES) {
      await expect(insertIndividualRow(await insertPersonalIdentity(), status)).resolves.toBeDefined();
    }
    await expect(insertIndividualRow(await insertPersonalIdentity(), "not_a_real_status")).rejects.toThrow();
  });
});
