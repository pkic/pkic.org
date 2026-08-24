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
import { createManagedFormPlacement } from "../functions/_lib/services/forms";
import { assignLocalGroupLeadership, createGroup, joinGroup, updateGroup } from "../functions/_lib/services/groups";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

interface ResourceFixture {
  owner: Awaited<ReturnType<typeof createGroup>>;
  grantee: Awaited<ReturnType<typeof createGroup>>;
  outsider: Awaited<ReturnType<typeof createGroup>>;
  formPlacementId: string;
  eventId: string;
  voteId: string;
  mailingListId: string;
}

async function insertActor(label: string, role = "user"): Promise<UserBackedAuthAdmin> {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

async function addParticipant(groupId: string, label: string): Promise<UserBackedAuthAdmin> {
  const actor = await insertActor(label);
  const organizationId = await insertOrganization(env.DB, `${label} ${crypto.randomUUID()}`);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  await addRepresentative(env.DB, memberId, actor.id);
  await joinGroup(env.DB, groupId, {
    actorUserId: actor.id,
    targetUserId: actor.id,
    selection: { mode: "all_eligible", confirmed: true },
    source: "self_service",
    allowManaged: false,
  });
  return actor;
}

async function addGroupLeader(groupId: string, label: string): Promise<UserBackedAuthAdmin> {
  const actor = await insertActor(label);
  await env.DB.prepare(
    `INSERT INTO user_roles
       (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
     VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), actor.id, groupId)
    .run();
  return actor;
}

async function createFixture(): Promise<ResourceFixture> {
  const admin = await insertActor("resource-admin", "admin");
  const owner = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Resource Owner ${crypto.randomUUID()}`,
    eligibilityMode: "open",
  });
  const grantee = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Resource Grantee ${crypto.randomUUID()}`,
    eligibilityMode: "open",
  });
  const outsider = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Resource Outsider ${crypto.randomUUID()}`,
    eligibilityMode: "open",
  });
  const formId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO forms
       (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
     VALUES (?, ?, 'global', NULL, 'survey', 'active', 'Shared survey', NULL, datetime('now'), datetime('now'))`,
  )
    .bind(formId, `shared-survey-${crypto.randomUUID()}`)
    .run();
  const placement = await createManagedFormPlacement(env.DB, admin.id, formId, {
    ownerGroupId: owner.id,
    contextType: "group",
    contextRef: owner.id,
    audience: "group_member",
    active: true,
  });
  const eventId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events
       (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json,
        owner_group_id, profile_key, source_mode, created_at, updated_at)
     VALUES (?, ?, 'Shared event', 'UTC', 'no_registration', 5, '{}', ?, 'meeting', 'portal',
             datetime('now'), datetime('now'))`,
  )
    .bind(eventId, `shared-event-${crypto.randomUUID()}`, owner.id)
    .run();
  const voteId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO votes
       (id, slug, title, vote_type, owner_group_id, electorate_mode, created_by_user_id,
        threshold_type, opens_at, closes_at, status, created_at, updated_at)
     VALUES (?, ?, 'Shared vote', 'motion', ?, 'per_member', ?, 'simple_majority',
             '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 'scheduled',
             datetime('now'), datetime('now'))`,
  )
    .bind(voteId, `shared-vote-${crypto.randomUUID()}`, owner.id, admin.id)
    .run();
  const mailingListId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO mailing_lists
       (id, email, label, purpose, group_id, is_primary_discussion, subscription_default,
        posting_policy, moderation_policy, active, created_at, updated_at)
     VALUES (?, ?, 'Shared list', 'group', ?, 0, 'none', 'subscribers', 'moderated', 1,
             datetime('now'), datetime('now'))`,
  )
    .bind(mailingListId, `shared-${crypto.randomUUID()}@lists.example.test`, owner.id)
    .run();
  return { owner, grantee, outsider, formPlacementId: placement.id, eventId, voteId, mailingListId };
}

async function detachTestMailingLists(): Promise<void> {
  await env.DB.prepare(
    "UPDATE mailing_lists SET group_id = NULL, active = 0, archived_at = datetime('now') WHERE email LIKE 'shared-%@lists.example.test'",
  ).run();
}

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
      await canAccessGroupResource(env.DB, granteeMember, "formPlacement", fixture.formPlacementId, "view_responses"),
    ).toBe(false);
    expect(
      await canAccessGroupResource(env.DB, granteeLeader, "formPlacement", fixture.formPlacementId, "view_responses"),
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
