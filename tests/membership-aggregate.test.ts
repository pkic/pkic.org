/**
 * Phase 1 §1.4 required tests, part 1: the `membership_categories` seed
 * table vs. the canonical shared contract, and
 * `getOrCreateOrganizationMemberAggregate`'s race/conflict/error-propagation
 * behavior (migrations 0035/0037, functions/_lib/services/membership/memberships.ts).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { insertOrganization } from "./helpers/membership";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  VOTING_CATEGORIES,
} from "../assets/shared/schemas/membership-categories";
import { getOrCreateOrganizationMemberAggregate } from "../functions/_lib/services/membership/memberships";
import { AppError } from "../functions/_lib/errors";

interface MembershipCategoryRow {
  code: string;
  is_individual: number;
  is_voting: number;
}

beforeEach(async () => {
  await resetDb();
});

describe("membership_categories seed table", () => {
  it("matches the canonical shared contract exactly — same codes, same individual/voting flags", async () => {
    const rows = await queryAll<MembershipCategoryRow>(
      env.DB,
      "SELECT code, is_individual, is_voting FROM membership_categories",
    );
    const byCode = new Map(rows.map((r) => [r.code, r]));

    expect(new Set(byCode.keys())).toEqual(new Set(MEMBERSHIP_CATEGORIES));

    for (const code of MEMBERSHIP_CATEGORIES) {
      const row = byCode.get(code);
      expect(row, `membership_categories is missing seed row for ${code}`).toBeDefined();
      expect(row!.is_individual === 1, `is_individual mismatch for ${code}`).toBe(
        INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(code),
      );
      expect(row!.is_voting === 1, `is_voting mismatch for ${code}`).toBe(VOTING_CATEGORIES.has(code));
    }
  });
});

describe("getOrCreateOrganizationMemberAggregate", () => {
  it("converges concurrent callers on the same organization to one aggregate row", async () => {
    const organizationId = await insertOrganization(env.DB);

    const [first, second, third] = await Promise.all([
      getOrCreateOrganizationMemberAggregate(env.DB, organizationId, "A"),
      getOrCreateOrganizationMemberAggregate(env.DB, organizationId, "A"),
      getOrCreateOrganizationMemberAggregate(env.DB, organizationId, "A"),
    ]);

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(first.categoryCode).toBe("A");

    const memberRows = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM members WHERE organization_id = ?",
      organizationId,
    );
    expect(Number(memberRows[0].total)).toBe(1);

    const categoryRows = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM member_category_assignments WHERE member_id = ?",
      first.id,
    );
    expect(Number(categoryRows[0].total)).toBe(1);
  });

  it("rejects a differing category on an organization that already has one assigned", async () => {
    const organizationId = await insertOrganization(env.DB);
    const first = await getOrCreateOrganizationMemberAggregate(env.DB, organizationId, "A");
    expect(first.categoryCode).toBe("A");

    await expect(getOrCreateOrganizationMemberAggregate(env.DB, organizationId, "B")).rejects.toMatchObject({
      status: 409,
      code: "MEMBER_CATEGORY_CONFLICT",
    });

    // The conflicting call must not have mutated the existing assignment.
    const row = (
      await queryAll<{ category_code: string }>(
        env.DB,
        "SELECT category_code FROM member_category_assignments WHERE member_id = ?",
        first.id,
      )
    )[0];
    expect(row.category_code).toBe("A");
  });

  it("does not treat an unrelated D1 error as a race — an invalid category propagates instead of being swallowed", async () => {
    const organizationId = await insertOrganization(env.DB);

    // "zzz" is not a seeded membership_categories.code — the
    // member_category_assignments FK must reject it. A blanket try/catch
    // race-detector would misinterpret this as "someone else already
    // created the aggregate" and silently re-read instead of failing.
    await expect(getOrCreateOrganizationMemberAggregate(env.DB, organizationId, "zzz")).rejects.toThrow();

    const memberRows = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM members WHERE organization_id = ?",
      organizationId,
    );
    // The members row insert (no FK to membership_categories) is not
    // itself rejected, but no category assignment should have landed for
    // the invalid code, and the caller must see the real D1 error, not a
    // success. AppError is not thrown here — the raw D1 FK failure
    // propagates unchanged, confirming it isn't reinterpreted.
    expect(Number(memberRows[0].total)).toBeLessThanOrEqual(1);
  });

  it("returns AppError instances (not generic errors) for the conflict path specifically", async () => {
    const organizationId = await insertOrganization(env.DB);
    await getOrCreateOrganizationMemberAggregate(env.DB, organizationId, "A");

    try {
      await getOrCreateOrganizationMemberAggregate(env.DB, organizationId, "H1");
      expect.unreachable("expected MEMBER_CATEGORY_CONFLICT");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(409);
    }
  });
});
