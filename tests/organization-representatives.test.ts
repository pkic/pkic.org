/**
 * Phase 1 §1.4 required tests, part 2: organization_representatives
 * invariants (consolidated migration 0035) — concurrent multi-organization
 * representation, transfer, and rejoin.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { insertUser, insertOrganization, seedOrganizationAggregate, addRepresentative } from "./helpers/membership";
import {
  buildAddRepresentativeStatement,
  buildTransferRepresentativeStatements,
  buildCloseRepresentativeStatement,
  isActiveRepresentative,
} from "../functions/_lib/services/membership/representatives";

interface RepresentativeRow {
  id: string;
  member_id: string;
  user_id: string;
  left_at: string | null;
}

beforeEach(async () => {
  await resetDb();
});

describe("organization_representatives — concurrent multi-organization representation", () => {
  it("lets one person hold two simultaneously-active representative rows for two different organizations", async () => {
    const userId = await insertUser(env.DB);
    const orgAId = await insertOrganization(env.DB);
    const orgBId = await insertOrganization(env.DB);
    const memberAId = await seedOrganizationAggregate(env.DB, orgAId, "A");
    const memberBId = await seedOrganizationAggregate(env.DB, orgBId, "B");

    await addRepresentative(env.DB, memberAId, userId);
    await addRepresentative(env.DB, memberBId, userId);

    const activeRows = await queryAll<RepresentativeRow>(
      env.DB,
      "SELECT id, member_id, user_id, left_at FROM organization_representatives WHERE user_id = ? AND left_at IS NULL",
      userId,
    );
    expect(activeRows).toHaveLength(2);
    expect(new Set(activeRows.map((r) => r.member_id))).toEqual(new Set([memberAId, memberBId]));

    expect(await isActiveRepresentative(env.DB, memberAId, userId)).toBe(true);
    expect(await isActiveRepresentative(env.DB, memberBId, userId)).toBe(true);
  });

  it("rejects a second active row for the same (organization, user) pair — DB-enforced, not just app-level", async () => {
    const userId = await insertUser(env.DB);
    const orgId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");

    await addRepresentative(env.DB, memberId, userId);

    const { statement } = buildAddRepresentativeStatement(env.DB, { memberId, userId });
    await expect(env.DB.batch([statement])).rejects.toThrow();
  });
});

describe("organization_representatives — transfer", () => {
  it("moving a representative to a different organization closes left_at on the old row and opens a new active one", async () => {
    const userId = await insertUser(env.DB);
    const fromOrgId = await insertOrganization(env.DB);
    const toOrgId = await insertOrganization(env.DB);
    const fromMemberId = await seedOrganizationAggregate(env.DB, fromOrgId, "A");
    const toMemberId = await seedOrganizationAggregate(env.DB, toOrgId, "B");

    await addRepresentative(env.DB, fromMemberId, userId);

    const { statements } = buildTransferRepresentativeStatements(env.DB, {
      fromMemberId,
      toMemberId,
      userId,
    });
    await env.DB.batch(statements);

    const oldRow = (
      await queryAll<RepresentativeRow>(
        env.DB,
        "SELECT id, member_id, user_id, left_at FROM organization_representatives WHERE member_id = ? AND user_id = ?",
        fromMemberId,
        userId,
      )
    )[0];
    expect(oldRow.left_at).not.toBeNull();

    const newRow = (
      await queryAll<RepresentativeRow>(
        env.DB,
        "SELECT id, member_id, user_id, left_at FROM organization_representatives WHERE member_id = ? AND user_id = ?",
        toMemberId,
        userId,
      )
    )[0];
    expect(newRow.left_at).toBeNull();

    expect(await isActiveRepresentative(env.DB, fromMemberId, userId)).toBe(false);
    expect(await isActiveRepresentative(env.DB, toMemberId, userId)).toBe(true);
  });
});

describe("organization_representatives — rejoin", () => {
  it("a former representative rejoining the same organization creates a new row, not a reactivated one", async () => {
    const userId = await insertUser(env.DB);
    const orgId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");

    const firstRepId = await addRepresentative(env.DB, memberId, userId);
    await env.DB.batch([buildCloseRepresentativeStatement(env.DB, { memberId, userId })]);
    expect(await isActiveRepresentative(env.DB, memberId, userId)).toBe(false);

    // Rejoin: the partial unique index only constrains left_at IS NULL
    // rows, so a fresh insert for the same (member, user) pair succeeds
    // even though the old, now-inactive row still exists.
    const secondRepId = await addRepresentative(env.DB, memberId, userId);
    expect(secondRepId).not.toBe(firstRepId);
    expect(await isActiveRepresentative(env.DB, memberId, userId)).toBe(true);

    const rows = await queryAll<RepresentativeRow>(
      env.DB,
      "SELECT id, member_id, user_id, left_at FROM organization_representatives WHERE member_id = ? AND user_id = ? ORDER BY id",
      memberId,
      userId,
    );
    expect(rows).toHaveLength(2);
    const active = rows.filter((r) => r.left_at === null);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(secondRepId);
  });
});
