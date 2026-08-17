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
import {
  getOrCreateOrganizationMemberAggregate,
  buildCreateIndividualMemberStatements,
} from "../functions/_lib/services/membership/memberships";
import { listMembershipCategories } from "../functions/_lib/services/membership/categories";
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

  it("listMembershipCategories reads the same catalog through the service function", async () => {
    const entries = await listMembershipCategories(env.DB);
    const byCode = new Map(entries.map((e) => [e.code, e]));

    expect(new Set(byCode.keys())).toEqual(new Set(MEMBERSHIP_CATEGORIES));

    for (const code of MEMBERSHIP_CATEGORIES) {
      const entry = byCode.get(code);
      expect(entry, `listMembershipCategories is missing ${code}`).toBeDefined();
      expect(entry!.isIndividual).toBe(INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(code));
      expect(entry!.isVoting).toBe(VOTING_CATEGORIES.has(code));
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

  it("rejects an unknown category code before any write — a shared-service validation, not a D1 FK surprise", async () => {
    const organizationId = await insertOrganization(env.DB);

    // "zzz" is not a MEMBERSHIP_CATEGORIES code — assertCategoryCompatible
    // (functions/_lib/services/membership/memberships.ts) now rejects it
    // synchronously, before building any statement, so no partial members
    // row is ever written for an invalid code.
    try {
      await getOrCreateOrganizationMemberAggregate(env.DB, organizationId, "zzz");
      expect.unreachable("expected AppError for an unknown category code");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(422);
    }

    const memberRows = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM members WHERE organization_id = ?",
      organizationId,
    );
    expect(Number(memberRows[0].total)).toBe(0);
  });

  it("rejects an individual-only category (H5/H6/H7) for an organization aggregate", async () => {
    const organizationId = await insertOrganization(env.DB);
    try {
      await getOrCreateOrganizationMemberAggregate(env.DB, organizationId, "H5");
      expect.unreachable("expected AppError for an individual-only category on an organization aggregate");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(422);
      expect((err as AppError).code).toBe("MEMBERSHIP_CATEGORY_TYPE_MISMATCH");
    }
  });

  it("does not treat an unrelated D1 error as a race — a nonexistent organization propagates its own FK failure", async () => {
    // A valid, individual-compatible category ("A") passes the app-level
    // check, so this exercises the D1 layer itself: members.organization_id
    // FKs to organizations(id) (migration 0000), and no such organization
    // was created. A blanket try/catch race-detector would misinterpret
    // this as "someone else already created the aggregate" and silently
    // re-read instead of failing.
    await expect(getOrCreateOrganizationMemberAggregate(env.DB, crypto.randomUUID(), "A")).rejects.toThrow();
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

describe("buildCreateIndividualMemberStatements — category compatibility", () => {
  it("rejects an organization-tied category for an individual (org-less) aggregate", () => {
    expect(() =>
      buildCreateIndividualMemberStatements(env.DB, crypto.randomUUID(), "A", new Date().toISOString()),
    ).toThrow(AppError);
    try {
      buildCreateIndividualMemberStatements(env.DB, crypto.randomUUID(), "A", new Date().toISOString());
      expect.unreachable("expected AppError for an org-tied category on an individual aggregate");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(422);
      expect((err as AppError).code).toBe("MEMBERSHIP_CATEGORY_TYPE_MISMATCH");
    }
  });

  it("accepts every individual-only category (H5/H6/H7)", () => {
    for (const code of ["H5", "H6", "H7"]) {
      expect(() =>
        buildCreateIndividualMemberStatements(env.DB, crypto.randomUUID(), code, new Date().toISOString()),
      ).not.toThrow();
    }
  });
});
