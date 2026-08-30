import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { PERMISSIONS } from "../assets/shared/schemas/permissions";
import { ALL_PERSONAS, ALL_PERSONA_KEYS, PERSONAS, PERSONA_KEYS } from "./personas/catalog";
import { personaRequest, seedPersona } from "./personas/seed";
import { TEST_GROUPS } from "./helpers/voting";
import { seedEventAndAdmin } from "./helpers/context";
import app from "../functions/router";
import { createExecutionContext } from "cloudflare:test";

/**
 * A persona catalog that drifts is worse than none: tests keep passing while
 * describing people the product can no longer produce. These checks tie every
 * claim in the catalog back to the schema.
 */
describe("persona catalog", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("names only roles the product actually defines", async () => {
    const seeded = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles");
    const known = new Set(seeded.map((row) => row.id));
    const unknown = ALL_PERSONA_KEYS.flatMap((key) => ALL_PERSONAS[key].roles.map((role) => role.roleId)).filter(
      (roleId) => !known.has(roleId),
    );
    expect([...new Set(unknown)]).toEqual([]);
  });

  it("covers every role the product defines", async () => {
    const seeded = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles");
    const represented = new Set<string>(
      ALL_PERSONA_KEYS.flatMap((key) => ALL_PERSONAS[key].roles.map((role) => role.roleId)),
    );
    // A role nobody plays is a role nothing tests.
    const unplayed = seeded.map((row) => row.id).filter((roleId) => !represented.has(roleId));
    expect(unplayed).toEqual([]);
  });

  it("gives every permission a holder whose authority stops there", async () => {
    // An administrator holds everything, so it can only ever demonstrate that
    // a permission works — never that lacking it is refused. Every capability
    // therefore needs a narrower holder too, or the system cannot be swept
    // for authorization boundaries.
    const bundles = await queryAll<{ role_id: string; permission: string }>(
      env.DB,
      "SELECT role_id, permission FROM role_permissions",
    );
    const byRole = new Map<string, string[]>();
    for (const row of bundles) byRole.set(row.role_id, [...(byRole.get(row.role_id) ?? []), row.permission]);

    const narrowlyHeld = new Set<string>();
    for (const key of ALL_PERSONA_KEYS) {
      const persona = ALL_PERSONAS[key];
      if (persona.roles.some((role) => role.roleId === "role-admin")) continue;
      for (const grant of persona.grants) narrowlyHeld.add(grant);
      for (const role of persona.roles) {
        for (const permission of byRole.get(role.roleId) ?? []) narrowlyHeld.add(permission);
      }
    }

    const uncovered = PERMISSIONS.filter((permission) => !narrowlyHeld.has(permission));
    expect(uncovered).toEqual([]);
  });

  it("grants only permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS);
    const unknown = PERSONA_KEYS.flatMap((key) => PERSONAS[key].grants).filter((permission) => !known.has(permission));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it("agrees with the database about who may vote", async () => {
    const categories = await queryAll<{ code: string; is_voting: number }>(
      env.DB,
      "SELECT code, is_voting FROM membership_categories",
    );
    const voting = new Map(categories.map((row) => [row.code, row.is_voting === 1]));

    for (const key of PERSONA_KEYS) {
      const persona = PERSONAS[key];
      const expected = persona.membershipCategory ? (voting.get(persona.membershipCategory) ?? false) : false;
      expect({ key, mayVote: persona.mayVote }).toEqual({ key, mayVote: expected });
    }
  });

  it("describes at least one persona who cannot vote and one who can", () => {
    // The interested-party rule is a bylaw, and a catalog with no
    // disenfranchised persona cannot test it.
    expect(PERSONA_KEYS.some((key) => PERSONAS[key].mayVote)).toBe(true);
    expect(PERSONA_KEYS.some((key) => PERSONAS[key].membershipCategory !== null && !PERSONAS[key].mayVote)).toBe(true);
  });

  it("gives every staff-only persona no membership at all", () => {
    // A staff identity that quietly carries a membership would hide exactly
    // the leak the portal separation exists to prevent.
    for (const key of PERSONA_KEYS) {
      const persona = PERSONAS[key];
      const staffOnly = persona.roles.some((role) => role.roleId === "role-admin") || persona.grants.length > 0;
      if (!staffOnly) continue;
      expect({ key, membershipCategory: persona.membershipCategory }).toEqual({ key, membershipCategory: null });
    }
  });
});

describe("seeded personas hold the authority the catalog claims", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function call(request: Request): Promise<Response> {
    return app.fetch(request, env as never, createExecutionContext());
  }

  it("seeds every persona without error", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    for (const key of ALL_PERSONA_KEYS) {
      const seeded = await seedPersona(env.DB, key, { groupId: TEST_GROUPS.pqc, eventId });
      expect({ key, capacities: seeded.capacities.length }).toEqual({
        key,
        capacities: ALL_PERSONAS[key].organizationCount,
      });
      expect(Boolean(seeded.token)).toBe(key !== "anonymous");
    }
  });

  it("lets a membership reader read applications but not move one", async () => {
    const reader = await seedPersona(env.DB, "membershipReader");
    const list = await call(personaRequest(reader, "/api/v1/members/applications"));
    expect(list.status).toBe(200);

    const moved = await call(
      personaRequest(reader, "/api/v1/members/applications/00000000000000000000000000000000/stage", {
        method: "PATCH",
        body: JSON.stringify({ toStage: "in_review" }),
      }),
    );
    expect(moved.status, "a read-only grant must not move an application").toBe(403);
  });

  it("refuses an anonymous persona everywhere a session is required", async () => {
    const anonymous = await seedPersona(env.DB, "anonymous");
    const response = await call(personaRequest(anonymous, "/api/v1/members/applications"));
    expect(response.status).toBe(401);
  });
});
