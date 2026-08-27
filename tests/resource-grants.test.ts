import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  EVENT_GROUP_CAPABILITIES,
  FORM_GROUP_CAPABILITIES,
  MAILING_LIST_GROUP_CAPABILITIES,
  VOTE_GROUP_CAPABILITIES,
  eventGroupGrantRouteSchemas,
} from "../assets/shared/schemas/resource-grants";
import {
  canAccessGroupResource,
  grantResourceToGroup,
  listResourceGroupGrants,
  revokeResourceGroupGrant,
} from "../functions/_lib/services/resource-grants";
import { assignLocalGroupLeadership, createGroup, updateGroup } from "../functions/_lib/services/groups";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";
import {
  addResourceGrantGroupLeader as addGroupLeader,
  addResourceGrantParticipant as addParticipant,
  createResourceGrantFixture as createFixture,
  detachResourceGrantFixtureMailingLists as detachTestMailingLists,
  insertResourceGrantActor as insertActor,
} from "./helpers/resource-grant-fixture";

beforeAll(detachTestMailingLists);

beforeEach(async () => {
  await resetDb();
});

afterEach(detachTestMailingLists);

describe("resource-specific grant schema", () => {
  it("uses the complete domain capability vocabularies", () => {
    expect(FORM_GROUP_CAPABILITIES).toEqual(["view_definition", "submit", "view_responses", "manage"]);
    expect(EVENT_GROUP_CAPABILITIES).toEqual(["view", "register", "attend", "manage_attendance", "manage"]);
    expect(VOTE_GROUP_CAPABILITIES).toEqual(["view", "participate", "view_results", "manage"]);
    expect(MAILING_LIST_GROUP_CAPABILITIES).toEqual(["view", "subscribe", "post", "moderate", "manage"]);
  });

  it("has one FK-backed table per resource and no polymorphic resource-id table", async () => {
    const tables = await queryAll<{ name: string }>(
      env.DB,
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE '%group_grants' ORDER BY name`,
    );
    expect(tables.map((row) => row.name)).toEqual([
      "event_group_grants",
      "form_placement_group_grants",
      "mailing_list_group_grants",
      "vote_group_grants",
    ]);
    const expectedTargets = new Map([
      ["event_group_grants", "events"],
      ["form_placement_group_grants", "form_placements"],
      ["mailing_list_group_grants", "mailing_lists"],
      ["vote_group_grants", "votes"],
    ]);
    for (const [table, target] of expectedTargets) {
      const foreignKeys = await queryAll<{ table: string }>(env.DB, `PRAGMA foreign_key_list('${table}')`);
      expect(foreignKeys.map((row) => row.table)).toContain(target);
      expect(foreignKeys.map((row) => row.table)).toContain("groups");
    }
  });

  it("uses resource-first and grantee-first indexes for both access directions", async () => {
    const indexedTables = [
      ["event_group_grants", "event_id", "idx_event_group_grants_group"],
      ["form_placement_group_grants", "placement_id", "idx_form_placement_group_grants_group"],
      ["mailing_list_group_grants", "mailing_list_id", "idx_mailing_list_group_grants_group"],
      ["vote_group_grants", "vote_id", "idx_vote_group_grants_group"],
    ] as const;
    for (const [table, resourceColumn, reverseIndex] of indexedTables) {
      const resourcePlan = await queryAll<{ detail: string }>(
        env.DB,
        `EXPLAIN QUERY PLAN SELECT group_id, capability FROM ${table} WHERE ${resourceColumn} = ?`,
        ["resource-id"],
      );
      expect(resourcePlan.some((row) => row.detail.includes("USING COVERING INDEX sqlite_autoindex"))).toBe(true);
      const granteePlan = await queryAll<{ detail: string }>(
        env.DB,
        `EXPLAIN QUERY PLAN SELECT ${resourceColumn} FROM ${table} WHERE group_id = ? AND capability = ?`,
        ["group-id", "view"],
      );
      expect(granteePlan.some((row) => row.detail.includes(`USING COVERING INDEX ${reverseIndex}`))).toBe(true);
    }
  });
});

describe("shared resource grant management", () => {
  it("manages every resource through one idempotent, paginated, audited service", async () => {
    const fixture = await createFixture();
    const admin = await insertActor("grant-admin", "admin");
    const cases = [
      ["formPlacement", fixture.formPlacementId, "submit"],
      ["event", fixture.eventId, "attend"],
      ["vote", fixture.voteId, "view_results"],
      ["mailingList", fixture.mailingListId, "post"],
    ] as const;
    for (const [kind, resourceId, capability] of cases) {
      const first = await grantResourceToGroup(env.DB, admin, fixture.owner.id, kind, resourceId, {
        granteeGroupId: fixture.grantee.id,
        capability,
      });
      expect(first.created).toBe(true);
      const repeated = await grantResourceToGroup(env.DB, admin, fixture.owner.slug, kind, resourceId, {
        granteeGroupId: fixture.grantee.id,
        capability,
      });
      expect(repeated.created).toBe(false);
      const page = await listResourceGroupGrants(env.DB, admin, fixture.owner.id, kind, resourceId, {
        q: "Resource Grantee",
        capability,
        limit: 1,
        offset: 0,
        sort: "group",
      });
      expect(page.total).toBe(1);
      expect(page.grants[0]).toMatchObject({
        granteeGroup: { id: fixture.grantee.id },
        capability,
      });
    }
    const audits = await queryAll<{ action: string }>(
      env.DB,
      `SELECT action FROM audit_log
        WHERE action LIKE '%_group_grant_created' AND scope_type = 'group' AND scope_id = ?`,
      [fixture.owner.id],
    );
    expect(audits).toHaveLength(4);
    const owners = await queryAll<{ owner_group_id: string }>(
      env.DB,
      `SELECT owner_group_id FROM form_placements WHERE id = ?
       UNION ALL SELECT owner_group_id FROM events WHERE id = ?
       UNION ALL SELECT owner_group_id FROM votes WHERE id = ?
       UNION ALL SELECT group_id AS owner_group_id FROM mailing_lists WHERE id = ?`,
      [fixture.formPlacementId, fixture.eventId, fixture.voteId, fixture.mailingListId],
    );
    expect(owners.every((row) => row.owner_group_id === fixture.owner.id)).toBe(true);
  });

  it("rolls back grant creation when owner-group management is revoked before commit", async () => {
    const fixture = await createFixture();
    const manager = await addGroupLeader(fixture.owner.id, "grant-race-lead");
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ? AND context_id = ?")
        .bind(manager.id, fixture.owner.id)
        .run(),
    );

    await expect(
      grantResourceToGroup(racingDb, manager, fixture.owner.id, "formPlacement", fixture.formPlacementId, {
        granteeGroupId: fixture.grantee.id,
        capability: "submit",
      }),
    ).rejects.toMatchObject({ status: 409, code: "RESOURCE_GRANT_AUTHORIZATION_CHANGED" });
    expect(
      await queryAll(
        env.DB,
        "SELECT placement_id FROM form_placement_group_grants WHERE placement_id = ? AND group_id = ?",
        [fixture.formPlacementId, fixture.grantee.id],
      ),
    ).toHaveLength(0);
  });

  it("rolls back grant revocation when owner-group management is revoked before commit", async () => {
    const fixture = await createFixture();
    const admin = await insertActor("grant-race-admin", "admin");
    await grantResourceToGroup(env.DB, admin, fixture.owner.id, "event", fixture.eventId, {
      granteeGroupId: fixture.grantee.id,
      capability: "register",
    });
    const manager = await addGroupLeader(fixture.owner.id, "revoke-race-lead");
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ? AND context_id = ?")
        .bind(manager.id, fixture.owner.id)
        .run(),
    );

    await expect(
      revokeResourceGroupGrant(racingDb, manager, fixture.owner.id, "event", fixture.eventId, {
        granteeGroupId: fixture.grantee.id,
        capability: "register",
      }),
    ).rejects.toMatchObject({ status: 409, code: "RESOURCE_GRANT_AUTHORIZATION_CHANGED" });
    expect(
      await queryAll(
        env.DB,
        "SELECT event_id FROM event_group_grants WHERE event_id = ? AND group_id = ? AND capability = 'register'",
        [fixture.eventId, fixture.grantee.id],
      ),
    ).toHaveLength(1);
  });

  it("validates and serves the shared list/create/revoke contract through the mounted router", async () => {
    const fixture = await createFixture();
    const admin = await insertActor("route-admin", "admin");
    const token = await createAdminSession(env.DB, admin.id, `resource-route-${crypto.randomUUID()}`);
    const request = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      if (init.body) headers.set("content-type", "application/json");
      return callApi(env, path, { ...init, headers });
    };
    const path = `/api/v1/groups/${fixture.owner.id}/events/${fixture.eventId}/grants`;
    const ownerTransferAttempt = await request(path, {
      method: "POST",
      body: JSON.stringify({
        granteeGroupId: fixture.grantee.id,
        capability: "attend",
        ownerGroupId: fixture.outsider.id,
      }),
    });
    expect(ownerTransferAttempt.status).toBe(400);
    const created = await request(path, {
      method: "POST",
      body: JSON.stringify({ granteeGroupId: fixture.grantee.id, capability: "attend" }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    expect(eventGroupGrantRouteSchemas.mutationResponseSchema.parse(await created.json())).toMatchObject({
      success: true,
      created: true,
      grant: { granteeGroup: { id: fixture.grantee.id }, capability: "attend" },
    });
    const repeated = await request(path, {
      method: "POST",
      body: JSON.stringify({ granteeGroupId: fixture.grantee.id, capability: "attend" }),
    });
    expect(repeated.status).toBe(200);
    const listed = await request(`${path}?q=Grantee&capability=attend&sort=group&limit=1`);
    expect(listed.status, await listed.clone().text()).toBe(200);
    expect(eventGroupGrantRouteSchemas.listResponseSchema.parse(await listed.json())).toMatchObject({
      grants: [{ granteeGroup: { id: fixture.grantee.id }, capability: "attend" }],
      page: { total: 1, hasMore: false },
    });
    expect((await request(`${path}?capability=participate`)).status).toBe(400);
    const revoked = await request(`${path}/${fixture.grantee.id}/attend`, { method: "DELETE" });
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    expect(await revoked.json()).toEqual({ success: true });
  });

  it("requires owner governance, rejects owner self-grants, and revokes exactly one grant", async () => {
    const fixture = await createFixture();
    const ownerLeader = await addGroupLeader(fixture.owner.id, "owner-leader");
    const outsiderLeader = await addGroupLeader(fixture.outsider.id, "outsider-leader");
    await expect(
      grantResourceToGroup(env.DB, outsiderLeader, fixture.owner.id, "event", fixture.eventId, {
        granteeGroupId: fixture.grantee.id,
        capability: "view",
      }),
    ).rejects.toMatchObject({ code: "GROUP_MANAGEMENT_REQUIRED" });
    await expect(
      grantResourceToGroup(env.DB, ownerLeader, fixture.owner.id, "event", fixture.eventId, {
        granteeGroupId: fixture.owner.id,
        capability: "view",
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_OWNER_GRANT_REDUNDANT" });
    await grantResourceToGroup(env.DB, ownerLeader, fixture.owner.id, "event", fixture.eventId, {
      granteeGroupId: fixture.grantee.id,
      capability: "view",
    });
    await revokeResourceGroupGrant(env.DB, ownerLeader, fixture.owner.id, "event", fixture.eventId, {
      granteeGroupId: fixture.grantee.id,
      capability: "view",
    });
    await expect(
      revokeResourceGroupGrant(env.DB, ownerLeader, fixture.owner.id, "event", fixture.eventId, {
        granteeGroupId: fixture.grantee.id,
        capability: "view",
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_GRANT_NOT_FOUND" });
  });

  it("inherits owner management from the parent and stops it after an authorized local-only cutover", async () => {
    const fixture = await createFixture();
    const admin = await insertActor("hierarchy-admin", "admin");
    const parent = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Grant Parent ${crypto.randomUUID()}`,
      eligibilityMode: "open",
    });
    const child = await createGroup(env.DB, admin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: `Grant Child ${crypto.randomUUID()}`,
      eligibilityMode: "open",
    });
    const parentLeader = await addGroupLeader(parent.id, "grant-parent-leader");
    const localLeader = await insertActor("grant-local-leader");
    await assignLocalGroupLeadership(env.DB, parentLeader, child.id, {
      userId: localLeader.id,
      roleId: "role-group_lead",
    });
    const eventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events
         (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json,
          owner_group_id, profile_key, source_mode, created_at, updated_at)
       VALUES (?, ?, 'Inherited grant event', 'UTC', 'no_registration', 5, '{}', ?, 'meeting', 'portal',
               datetime('now'), datetime('now'))`,
    )
      .bind(eventId, `inherited-grant-${crypto.randomUUID()}`, child.id)
      .run();
    await expect(
      grantResourceToGroup(env.DB, parentLeader, child.id, "event", eventId, {
        granteeGroupId: fixture.grantee.id,
        capability: "view",
      }),
    ).resolves.toMatchObject({ created: true });
    await updateGroup(env.DB, parentLeader, child.id, { governanceInheritanceMode: "local_only" });
    await expect(
      grantResourceToGroup(env.DB, parentLeader, child.id, "event", eventId, {
        granteeGroupId: fixture.grantee.id,
        capability: "register",
      }),
    ).rejects.toMatchObject({ code: "GROUP_MANAGEMENT_REQUIRED" });
    await expect(
      grantResourceToGroup(env.DB, localLeader, child.id, "event", eventId, {
        granteeGroupId: fixture.grantee.id,
        capability: "register",
      }),
    ).resolves.toMatchObject({ created: true });
  });
});

describe("shared resource access evaluator", () => {
  it("separates participant capabilities from leadership-only response and management capabilities", async () => {
    const fixture = await createFixture();
    const admin = await insertActor("access-admin", "admin");
    const granteeMember = await addParticipant(fixture.grantee.id, "grantee-member");
    const granteeLeader = await addGroupLeader(fixture.grantee.id, "grantee-leader");
    const ownerMember = await addParticipant(fixture.owner.id, "owner-member");
    await grantResourceToGroup(env.DB, admin, fixture.owner.id, "formPlacement", fixture.formPlacementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "submit",
    });
    await grantResourceToGroup(env.DB, admin, fixture.owner.id, "formPlacement", fixture.formPlacementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "view_responses",
    });
    expect(
      await canAccessGroupResource(env.DB, granteeMember, "formPlacement", fixture.formPlacementId, "submit"),
    ).toBe(true);
    expect(
      await canAccessGroupResource(env.DB, granteeMember, "formPlacement", fixture.formPlacementId, "view_definition"),
    ).toBe(true);
    expect(
      await canAccessGroupResource(env.DB, granteeMember, "formPlacement", fixture.formPlacementId, "view_responses"),
    ).toBe(false);
    expect(
      await canAccessGroupResource(env.DB, granteeLeader, "formPlacement", fixture.formPlacementId, "view_responses"),
    ).toBe(true);
    expect(
      await canAccessGroupResource(env.DB, granteeLeader, "formPlacement", fixture.formPlacementId, "view_definition"),
    ).toBe(true);
    expect(
      await canAccessGroupResource(env.DB, granteeLeader, "formPlacement", fixture.formPlacementId, "submit"),
    ).toBe(false);
    expect(await canAccessGroupResource(env.DB, ownerMember, "formPlacement", fixture.formPlacementId, "submit")).toBe(
      true,
    );
    await grantResourceToGroup(env.DB, admin, fixture.owner.id, "formPlacement", fixture.formPlacementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "manage",
    });
    expect(
      await canAccessGroupResource(env.DB, granteeLeader, "formPlacement", fixture.formPlacementId, "manage"),
    ).toBe(true);
    expect(
      await canAccessGroupResource(env.DB, granteeLeader, "formPlacement", fixture.formPlacementId, "submit"),
    ).toBe(false);
    expect(
      await canAccessGroupResource(env.DB, granteeMember, "formPlacement", fixture.formPlacementId, "manage"),
    ).toBe(false);
  });

  it("revokes access immediately and preserves resource/grantee foreign-key integrity", async () => {
    const fixture = await createFixture();
    const admin = await insertActor("integrity-admin", "admin");
    const granteeMember = await addParticipant(fixture.grantee.id, "integrity-member");
    await grantResourceToGroup(env.DB, admin, fixture.owner.id, "event", fixture.eventId, {
      granteeGroupId: fixture.grantee.id,
      capability: "attend",
    });
    expect(await canAccessGroupResource(env.DB, granteeMember, "event", fixture.eventId, "attend")).toBe(true);
    await revokeResourceGroupGrant(env.DB, admin, fixture.owner.id, "event", fixture.eventId, {
      granteeGroupId: fixture.grantee.id,
      capability: "attend",
    });
    expect(await canAccessGroupResource(env.DB, granteeMember, "event", fixture.eventId, "attend")).toBe(false);
    await expect(
      env.DB.prepare(
        `INSERT INTO event_group_grants
           (event_id, group_id, capability, created_by_user_id, created_at)
         VALUES ('missing-event', ?, 'view', ?, datetime('now'))`,
      )
        .bind(fixture.grantee.id, admin.id)
        .run(),
    ).rejects.toThrow(/foreign key/i);
  });
});
