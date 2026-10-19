import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupSchema, type Group } from "../assets/shared/schemas/groups";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { grantAdministrator } from "./helpers/administrator";
import { insertUser } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { readPublicPersonProfile } from "./helpers/person-profile";
import { nowIso } from "../functions/_lib/utils/time";
import { resetDb } from "./helpers/reset-db";

let token: string;
let adminId: string;
async function command(path: string, method: string, body: unknown) {
  return callApi(env, `/api/v1/groups${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function create(visibility: Group["visibility"] = "public", extra: Record<string, unknown> = {}) {
  const response = await command("", "POST", {
    typeKey: "working_group",
    name: "Publication group",
    slug: "publication-group",
    visibility,
    ...extra,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return groupSchema.parse(((await response.json()) as { group: unknown }).group);
}
const requests = () =>
  queryAll(
    env.DB,
    "SELECT resource_id,reason_code FROM site_publication_requests WHERE resource_type='group_content' ORDER BY sequence",
  );
const snapshot = async () => (await readSitePublicationSnapshot(env.DB, [])).groups;

beforeEach(async () => {
  await resetDb();
  const userId = await insertUser(env.DB, "group-publication-admin@example.test");
  adminId = userId;
  await grantAdministrator(env.DB, userId);
  token = await createAdminSession(env.DB, userId, "group-publication-admin-token");
});

describe("publication after group metadata changes", () => {
  it.each(["public", "authenticated"] as const)(
    "publishes creation only when the group is exported: %s",
    async (visibility) => {
      const before = await snapshot();
      const group = await create(visibility);
      expect((await snapshot())[group.slug] !== undefined).toBe(visibility === "public");
      if (visibility === "authenticated") expect(await snapshot()).toEqual(before);
      expect(await requests()).toEqual(
        visibility === "public" ? [{ resource_id: group.id, reason_code: "group_content_changed" }] : [],
      );
    },
  );

  it.each([
    { state: "rename", patch: { name: "Renamed public group" }, changed: true },
    { state: "slug", patch: { slug: "renamed-public-group" }, changed: true },
    { state: "withdraw", patch: { visibility: "authenticated" }, changed: true },
    { state: "deactivate", patch: { active: false }, changed: true },
    { state: "roster", patch: { publicRoster: true }, changed: true },
    { state: "same", patch: { name: "Publication group" }, changed: false },
    { state: "internal", patch: { minEndorsersForBallot: 3 }, changed: false },
    { state: "description", patch: { description: "Internal group description" }, changed: false },
    { state: "private", patch: { name: "Renamed private group" }, changed: false },
    { state: "expose", patch: { publicLeadership: true }, changed: true },
  ])("queues actual exported changes: $state", async ({ state, patch, changed }) => {
    const group = await create(state === "private" || state === "expose" ? "authenticated" : "public");
    const before = await snapshot();
    const beforeRequests = await requests();
    const response = await command(`/${group.id}`, "PATCH", { expectedRevision: group.revision, ...patch });
    expect(response.status, await response.clone().text()).toBe(200);
    if (changed) expect(await snapshot()).not.toEqual(before);
    else expect(await snapshot()).toEqual(before);
    expect(await requests()).toHaveLength(beforeRequests.length + Number(changed));
  });

  it.each(["public", "authenticated"] as const)("publishes only disclosed ancestor names: %s", async (visibility) => {
    const parent = await create(visibility);
    const child = await create("authenticated", {
      name: "Public child",
      slug: "public-child",
      parentGroupId: parent.id,
      publicLeadership: true,
    });
    await grantGroupLeadershipCapacity(env.DB, parent.id, adminId);
    expect((await command(`/${parent.id}`, "PATCH", { active: false })).status).toBe(200);
    const before = await snapshot();
    expect(before[child.slug].leadership).not.toHaveLength(0);
    const beforeRequests = await requests();
    expect((await command(`/${parent.id}`, "PATCH", { name: "Renamed ancestor" })).status).toBe(200);
    if (visibility === "public") expect(await snapshot()).not.toEqual(before);
    else expect(await snapshot()).toEqual(before);
    expect(await requests()).toHaveLength(beforeRequests.length + Number(visibility === "public"));
  });

  it("publishes a renamed group on an addressed contributor profile", async () => {
    const group = await create("authenticated", { publicLeadership: true });
    await grantGroupLeadershipCapacity(env.DB, group.id, adminId);
    await issueContributorProfileAddresses(env.DB, nowIso(), 50);
    const before = await readPublicPersonProfile(adminId);
    expect(before).toBeDefined();
    const beforeRequests = await requests();
    expect((await command(`/${group.id}`, "PATCH", { name: "Renamed contribution" })).status).toBe(200);
    expect(await readPublicPersonProfile(adminId)).not.toEqual(before);
    expect(await requests()).toHaveLength(beforeRequests.length + 1);
  });

  it("publishes a private group name credited by a public vote", async () => {
    const group = await create("authenticated");
    await env.DB.prepare(`INSERT INTO votes
      (id,slug,title,vote_type,owner_group_id,electorate_mode,created_by_user_id,threshold_type,visibility,opens_at,closes_at,created_at,updated_at)
      VALUES (?, 'group-publication-vote','Public motion','motion',?,'per_member',?,'simple_majority','public',
        '2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',?,?)`)
      .bind(crypto.randomUUID(), group.id, adminId, nowIso(), nowIso())
      .run();
    const before = (await readSitePublicationSnapshot(env.DB, [])).votes;
    expect(before).toHaveLength(1);
    const beforeRequests = await requests();
    expect((await command(`/${group.id}`, "PATCH", { name: "Renamed vote owner" })).status).toBe(200);
    expect((await readSitePublicationSnapshot(env.DB, [])).votes).not.toEqual(before);
    expect(await requests()).toHaveLength(beforeRequests.length + 1);
  });

  it.each([true, false])("publishes reparenting through inherited descendants only: %s", async (inherited) => {
    const first = await create("authenticated");
    const second = await create("authenticated", { name: "Second ancestor", slug: "second-ancestor" });
    const parent = await create("authenticated", {
      name: "Intermediate",
      slug: "intermediate",
      parentGroupId: first.id,
    });
    const child = await create("authenticated", {
      name: "Inherited child",
      slug: "inherited-child",
      parentGroupId: parent.id,
      publicLeadership: true,
    });
    await grantGroupLeadershipCapacity(env.DB, first.id, adminId);
    const otherId = await insertUser(env.DB, "other-group-leader@example.test");
    await env.DB.prepare("UPDATE users SET first_name='Other leader' WHERE id=?").bind(otherId).run();
    await grantGroupLeadershipCapacity(env.DB, second.id, otherId);
    if (!inherited) {
      await grantGroupLeadershipCapacity(env.DB, child.id, adminId);
      expect((await command(`/${child.id}`, "PATCH", { governanceInheritanceMode: "local_only" })).status).toBe(200);
    }
    const before = await snapshot();
    const beforeRequests = await requests();
    expect((await command(`/${parent.id}`, "PATCH", { parentGroupId: second.id })).status).toBe(200);
    if (inherited) expect(await snapshot()).not.toEqual(before);
    else expect(await snapshot()).toEqual(before);
    expect(await requests()).toHaveLength(beforeRequests.length + Number(inherited));
  });

  it("rolls back public group creation on request failure and retries", async () => {
    const before = await snapshot();
    await env.DB.prepare(`CREATE TRIGGER fail_group_creation BEFORE INSERT ON site_publication_requests
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_GROUP_CREATION_FAILURE'); END`).run();
    try {
      expect(
        (
          await command("", "POST", {
            typeKey: "working_group",
            name: "Atomic creation",
            slug: "atomic-creation",
            visibility: "public",
          })
        ).status,
      ).toBe(500);
      expect(await snapshot()).toEqual(before);
      expect(await queryAll(env.DB, "SELECT id FROM groups WHERE slug='atomic-creation'")).toEqual([]);
      expect(await requests()).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_group_creation").run();
    }
    expect(
      (
        await command("", "POST", {
          typeKey: "working_group",
          name: "Atomic creation",
          slug: "atomic-creation",
          visibility: "public",
        })
      ).status,
    ).toBe(201);
    expect(await requests()).toHaveLength(1);
  });

  it.each(["request", "audit"])("rolls back a public update after %s failure and retries", async (failure) => {
    const group = await create();
    const before = await snapshot();
    const beforeRequests = await requests();
    await env.DB.prepare(`CREATE TRIGGER fail_group_content BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
      ${failure === "audit" ? "WHEN NEW.action='group_updated'" : ""}
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_GROUP_PUBLICATION_FAILURE'); END`).run();
    try {
      expect((await command(`/${group.id}`, "PATCH", { name: "Retried group" })).status).toBe(500);
      expect(await snapshot()).toEqual(before);
      expect(await requests()).toEqual(beforeRequests);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='group_updated'")).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_group_content").run();
    }
    expect((await command(`/${group.id}`, "PATCH", { name: "Retried group" })).status).toBe(200);
    expect(await snapshot()).not.toEqual(before);
    expect(await requests()).toHaveLength(beforeRequests.length + 1);
  });

  it("keeps a stale revision from leaving a request behind", async () => {
    const group = await create();
    const before = await snapshot();
    const beforeRequests = await requests();
    expect(
      (await command(`/${group.id}`, "PATCH", { expectedRevision: group.revision + 1, name: "Stale group" })).status,
    ).toBe(409);
    expect(await snapshot()).toEqual(before);
    expect(await requests()).toEqual(beforeRequests);
  });
});
