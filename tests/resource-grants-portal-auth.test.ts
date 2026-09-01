import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { groupsListResponseSchema } from "../assets/shared/schemas/groups";
import { createGroup, updateGroup } from "../functions/_lib/services/groups";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { resetDb } from "./helpers/reset-db";
import {
  addResourceGrantGroupLeader,
  createResourceGrantFixture,
  detachResourceGrantFixtureMailingLists,
  insertResourceGrantActor,
} from "./helpers/resource-grant-fixture";

function authenticatedRequest(token: string) {
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (init.body) headers.set("content-type", "application/json");
    return callApi(env, path, { ...init, headers });
  };
}

beforeAll(detachResourceGrantFixtureMailingLists);

beforeEach(resetDb);

afterEach(detachResourceGrantFixtureMailingLists);

describe("resource grant portal authorization", () => {
  it("allows only effective local or inherited group leaders to share resources and discover managed targets", async () => {
    const fixture = await createResourceGrantFixture();
    const catalogLeader = await addResourceGrantGroupLeader(fixture.owner.id, "resource-catalog-leader");
    await grantGroupLeadershipCapacity(env.DB, fixture.grantee.id, catalogLeader.id);
    const request = authenticatedRequest(
      await createAdminSession(
        env.DB,
        catalogLeader.id,
        `resource-local-${crypto.randomUUID()}`,
        undefined,
        catalogLeader.memberId,
      ),
    );

    const catalog = await request("/api/v1/groups?manageable=true&active=true&sort=name&limit=100");
    expect(catalog.status, await catalog.clone().text()).toBe(200);
    const managedIds = groupsListResponseSchema.parse(await catalog.json()).groups.map((group) => group.id);
    expect(managedIds).toEqual(expect.arrayContaining([fixture.owner.id, fixture.grantee.id]));
    expect(managedIds).not.toContain(fixture.outsider.id);

    const ownerPath = `/api/v1/groups/${fixture.owner.id}/events/${fixture.eventId}/grants`;
    const created = await request(ownerPath, {
      method: "POST",
      body: JSON.stringify({ granteeGroupId: fixture.grantee.id, capability: "attend" }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    expect((await request(`${ownerPath}?capability=attend`)).status).toBe(200);
    expect((await request(`${ownerPath}/${fixture.grantee.id}/attend`, { method: "DELETE" })).status).toBe(200);

    const admin = await insertResourceGrantActor("resource-inherited-admin", "admin");
    const parent = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Resource inherited parent ${crypto.randomUUID()}`,
      eligibilityMode: "open",
    });
    const child = await createGroup(env.DB, admin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: `Resource inherited child ${crypto.randomUUID()}`,
      eligibilityMode: "open",
    });
    const inheritedLeader = await addResourceGrantGroupLeader(parent.id, "resource-inherited-leader");
    const localChildLeader = await addResourceGrantGroupLeader(child.id, "resource-child-leader");
    const childEventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events
         (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json,
          owner_group_id, profile_key, source_mode, created_at, updated_at)
       VALUES (?, ?, 'Inherited route event', 'UTC', 'no_registration', 5, '{}', ?, 'meeting', 'portal',
               datetime('now'), datetime('now'))`,
    )
      .bind(childEventId, `inherited-route-${crypto.randomUUID()}`, child.id)
      .run();
    const inheritedRequest = authenticatedRequest(
      await createAdminSession(env.DB, inheritedLeader.id, `resource-inherited-${crypto.randomUUID()}`),
    );
    const childPath = `/api/v1/groups/${child.id}/events/${childEventId}/grants`;
    expect(
      (
        await inheritedRequest(childPath, {
          method: "POST",
          body: JSON.stringify({ granteeGroupId: fixture.grantee.id, capability: "view" }),
        })
      ).status,
    ).toBe(201);

    await updateGroup(env.DB, admin, child.id, { governanceInheritanceMode: "local_only" });
    const deniedAfterCutover = await inheritedRequest(childPath, {
      method: "POST",
      body: JSON.stringify({ granteeGroupId: fixture.grantee.id, capability: "register" }),
    });
    expect(deniedAfterCutover.status).toBe(403);

    const childRequest = authenticatedRequest(
      await createAdminSession(env.DB, localChildLeader.id, `resource-child-${crypto.randomUUID()}`),
    );
    expect(
      (
        await childRequest(childPath, {
          method: "POST",
          body: JSON.stringify({ granteeGroupId: fixture.grantee.id, capability: "register" }),
        })
      ).status,
    ).toBe(201);

    // Keep a non-management staff role so this verifies scoped authorization
    // revocation (403), not merely that removing the final staff role ends the
    // session (401).
    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
       VALUES (?, ?, 'role-membership_processor', NULL, NULL, 0, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), localChildLeader.id)
      .run();
    await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ? AND context_id = ?")
      .bind(localChildLeader.id, child.id)
      .run();
    expect((await childRequest(childPath)).status).toBe(403);
  });
});
