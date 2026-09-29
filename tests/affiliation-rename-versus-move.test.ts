import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { queryAll } from "./helpers/context";
import {
  addRepresentative,
  insertOrgRepresentative,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

/**
 * Two changes that look the same in a form and mean opposite things.
 *
 * An organization is renamed: one legal entity, a new name, and everybody who
 * speaks for it follows. A person changes employer: one person leaves, and
 * nobody moves with them. The schema separates the two — an identity is one
 * person's tie to one organization, with its own start and end, while the name
 * lives on the organization every identity points at — and these hold that
 * separation in place, because the surface that will one day offer both is the
 * same settings page.
 */
beforeEach(resetDb);

describe("renaming an organization against changing employer", () => {
  it("carries a rename to everybody who speaks for the organization", async () => {
    const first = await insertOrgRepresentative(env.DB, { email: "first@rename.example" });
    const colleagueId = await insertUser(env.DB, "second@rename.example");
    await addRepresentative(env.DB, first.memberId, colleagueId);

    await env.DB.prepare("UPDATE organizations SET name = ? WHERE id = ?")
      .bind("Renamed Entity", first.organizationId)
      .run();

    // Nobody's affiliation was touched, and both of them read the new name,
    // because the name was never copied onto either of them.
    const rows = await queryAll<{ user_id: string; name: string; ended_at: string | null }>(
      env.DB,
      `SELECT i.user_id, o.name, i.ended_at
         FROM identities i JOIN organizations o ON o.id = i.organization_id
        WHERE i.organization_id = ? ORDER BY i.user_id`,
      [first.organizationId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.name === "Renamed Entity")).toBe(true);
    expect(rows.every((row) => row.ended_at === null)).toBe(true);

    // And a rename is a rename: no second organization appeared beside it.
    expect(await queryAll(env.DB, "SELECT id FROM organizations WHERE id = ?", [first.organizationId])).toHaveLength(1);
  });

  it("moves one person to a new employer without moving their colleague", async () => {
    const mover = await insertOrgRepresentative(env.DB, { email: "mover@old.example" });
    const colleagueId = await insertUser(env.DB, "stayer@old.example");
    const colleagueIdentityId = await addRepresentative(env.DB, mover.memberId, colleagueId);
    const newOrganizationId = await insertOrganization(env.DB, "New Employer");
    await seedOrganizationAggregate(env.DB, newOrganizationId, "A");

    // Changing employer ends the tie to the old organization and starts one to
    // the new. It is two acts on one person, not an edit to a shared name.
    const at = new Date().toISOString();
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(at, mover.identityId).run();
    const movedIdentityId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO identities
         (id, user_id, organization_id, source, predecessor_identity_id, invited_at, started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'staff', ?, ?, ?, ?, ?)`,
    )
      .bind(movedIdentityId, mover.userId, newOrganizationId, mover.identityId, at, at, at, at)
      .run();

    const [colleague] = await queryAll<{ organization_id: string; ended_at: string | null }>(
      env.DB,
      "SELECT organization_id, ended_at FROM identities WHERE id = ?",
      [colleagueIdentityId],
    );
    expect(colleague.organization_id, "the colleague did not change employer").toBe(mover.organizationId);
    expect(colleague.ended_at).toBeNull();

    // The mover's own past is intact: the ended tie still names where they
    // were, which is what any record made back then resolves through.
    const [past] = await queryAll<{ organization_id: string; ended_at: string | null }>(
      env.DB,
      "SELECT organization_id, ended_at FROM identities WHERE id = ?",
      [mover.identityId],
    );
    expect(past.organization_id).toBe(mover.organizationId);
    expect(past.ended_at).not.toBeNull();

    // And the new tie knows which one it succeeded, so the two read as one
    // person's history rather than two unrelated people.
    const [moved] = await queryAll<{ organization_id: string; predecessor_identity_id: string | null }>(
      env.DB,
      "SELECT organization_id, predecessor_identity_id FROM identities WHERE id = ?",
      [movedIdentityId],
    );
    expect(moved.organization_id).toBe(newOrganizationId);
    expect(moved.predecessor_identity_id).toBe(mover.identityId);
  });

  /*
   * An organization identity cannot exist at an organization the consortium
   * does not know as a Member: a trigger refuses one whose organization has no
   * member aggregate. So "leaving for a company that is not a member" is not a
   * move at all — it is an ending, with nothing to arrive at, and the person
   * holds no organization identity until that company becomes a Member.
   */
  it("re-derives the membership capacity from the new employer rather than carrying the old one", async () => {
    const mover = await insertOrgRepresentative(env.DB, { email: "carrier@member-co.example" });
    const newOrganizationId = await insertOrganization(env.DB, "Next Employer");
    await seedOrganizationAggregate(env.DB, newOrganizationId, "A");

    const at = new Date().toISOString();
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(at, mover.identityId).run();
    const movedIdentityId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO identities
         (id, user_id, organization_id, source, predecessor_identity_id, invited_at, started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'staff', ?, ?, ?, ?, ?)`,
    )
      .bind(movedIdentityId, mover.userId, newOrganizationId, mover.identityId, at, at, at, at)
      .run();

    /*
     * Membership belongs to the organization, not to the person who
     * represented it, so nothing is carried: the new tie takes its capacity
     * from the new employer's own membership. Where the two differ — a
     * different category, or none at all — the person's standing changes with
     * the move rather than persisting from where they used to work.
     */
    const [moved] = await queryAll<{ member_id: string }>(
      env.DB,
      "SELECT member_id FROM identity_member_capacities WHERE identity_id = ?",
      [movedIdentityId],
    );
    const [newMember] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM members WHERE organization_id = ? AND member_type = 'organization'",
      [newOrganizationId],
    );
    expect(moved?.member_id, "the capacity belongs to the new employer's membership").toBe(newMember.id);
    expect(moved?.member_id).not.toBe(mover.memberId);

    const [past] = await queryAll<{ member_id: string }>(
      env.DB,
      "SELECT member_id FROM identity_member_capacities WHERE identity_id = ?",
      [mover.identityId],
    );
    expect(past?.member_id, "the old capacity stays with the affiliation that held it").toBe(mover.memberId);
  });
});
