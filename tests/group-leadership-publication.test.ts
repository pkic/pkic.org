import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupSchema, groupLeadershipListResponseSchema } from "../assets/shared/schemas/groups";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { grantAdministrator } from "./helpers/administrator";
import { ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { insertGroupSeat, readPublicPersonProfile } from "./helpers/person-profile";
import { insertIndividualMember, insertOrgRepresentative, insertUser } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { joinGroup } from "../functions/_lib/services/groups/membership";
import { assignLocalGroupLeadership } from "../functions/_lib/services/groups/leadership";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";

let token: string;
let admin: UserBackedAuthAdmin;
async function command(path: string, method: string, body?: unknown) {
  return callApi(env, `/api/v1/groups${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function createGroup(body: Record<string, unknown> = {}) {
  const response = await command("", "POST", {
    typeKey: "working_group",
    name: "Leadership publication",
    slug: "leadership-publication",
    visibility: "authenticated",
    ...body,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return groupSchema.parse(((await response.json()) as { group: unknown }).group);
}
async function fixture(
  options: {
    publicLeadership?: boolean;
    publicRoster?: boolean;
    child?: boolean;
    withSeat?: boolean;
    organization?: boolean;
    publicListing?: boolean;
  } = {},
) {
  const group = await createGroup({
    publicLeadership: options.publicLeadership ?? true,
    publicRoster: options.publicRoster ?? false,
    visibility: options.publicListing ? "public" : "authenticated",
  });
  const person = options.organization ? await insertOrgRepresentative(env.DB) : await insertIndividualMember(env.DB);
  await insertGroupSeat("leadership-anchor", { publicRoster: true }, person);
  await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  if (options.withSeat !== false) await ensureGroupMembershipCapacity(env.DB, group.id, person.userId);
  if (options.child)
    await createGroup({
      name: "Inherited leadership",
      slug: "inherited-leadership",
      parentGroupId: group.id,
      publicLeadership: true,
    });
  return { group, person, path: `/${group.id}/leadership` };
}
const requests = (groupId: string) =>
  queryAll(
    env.DB,
    "SELECT id FROM site_publication_requests WHERE resource_type='group_content' AND resource_id=? ORDER BY sequence",
    [groupId],
  );
async function projection() {
  const value = await readSitePublicationSnapshot(env.DB, []);
  return { groups: value.groups, members: value.groupMembers, people: value.people };
}
async function assign(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  const response = await command(f.path, "POST", {
    userId: f.person.userId,
    identityId: f.person.identityId,
    roleId: "role-group_lead",
    startsAt: "2025-01-01T00:00:00.000Z",
    ...extra,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  groupLeadershipListResponseSchema.parse(await response.json());
  const [{ id }] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM user_roles WHERE context_id=? AND user_id=? AND role_id='role-group_lead'",
    [f.group.id, f.person.userId],
  );
  return id;
}

beforeEach(async () => {
  await resetDb();
  const userId = await insertUser(env.DB, "leadership-publication-admin@example.test");
  const grants = await grantAdministrator(env.DB, userId);
  admin = { identityType: "user", id: userId, email: "leadership-publication-admin@example.test", grants };
  token = await createAdminSession(env.DB, userId, "leadership-publication-admin-token");
});

describe("publication after group leadership changes", () => {
  it.each([
    { publicLeadership: true, changed: true },
    { publicLeadership: true, closed: true, changed: true },
    { publicLeadership: false, publicRoster: true, closed: true, changed: false },
    { publicLeadership: false, publicRoster: true, changed: true },
    { publicLeadership: false, changed: false },
    { publicLeadership: false, child: true, changed: true },
    { publicLeadership: false, child: true, closed: true, changed: false },
  ])("publishes only affected public leadership: %j", async ({ closed, changed, ...options }) => {
    const f = await fixture(options);
    const before = await projection();
    const beforeRequests = await requests(f.group.id);
    await assign(f, closed ? { endsAt: "2025-02-01T00:00:00.000Z" } : {});
    if (changed) expect(await projection()).not.toEqual(before);
    else expect(await projection()).toEqual(before);
    expect(await requests(f.group.id)).toHaveLength(beforeRequests.length + Number(changed));
  });

  it("publishes assignment, term edits, closing, reopening and revocation on a person profile", async () => {
    const f = await fixture();
    const beforePerson = await readPublicPersonProfile(f.person.userId);
    let count = (await requests(f.group.id)).length;
    const id = await assign(f);
    expect(await readPublicPersonProfile(f.person.userId)).not.toEqual(beforePerson);
    expect(await requests(f.group.id)).toHaveLength(++count);
    for (const patch of [
      { title: "Co-Chair" },
      { endsAt: "2027-01-01T00:00:00.000Z" },
      { endsAt: "2025-02-01T00:00:00.000Z" },
      { endsAt: null },
    ]) {
      const before = await projection();
      expect((await command(`${f.path}/${id}`, "PATCH", patch)).status).toBe(200);
      expect(await projection()).not.toEqual(before);
      expect(await requests(f.group.id)).toHaveLength(++count);
    }
    const beforeRevoke = await projection();
    expect((await command(`${f.path}/${id}`, "DELETE")).status).toBe(200);
    expect(await projection()).not.toEqual(beforeRevoke);
    expect(await requests(f.group.id)).toHaveLength(count + 1);
  });

  it("publishes inherited title changes and revocation", async () => {
    const f = await fixture({ publicLeadership: false, child: true });
    const id = await assign(f);
    let count = (await requests(f.group.id)).length;
    const beforeEdit = await projection();
    expect((await command(`${f.path}/${id}`, "PATCH", { title: "Inherited Co-Chair" })).status).toBe(200);
    expect(await projection()).not.toEqual(beforeEdit);
    expect(await requests(f.group.id)).toHaveLength(++count);
    const beforeRevoke = await projection();
    expect((await command(`${f.path}/${id}`, "DELETE")).status).toBe(200);
    expect(await projection()).not.toEqual(beforeRevoke);
    expect(await requests(f.group.id)).toHaveLength(count + 1);
  });

  it("preserves the last local-only leader without leaving a request", async () => {
    const f = await fixture();
    const id = await assign(f);
    expect((await command(`/${f.group.id}`, "PATCH", { governanceInheritanceMode: "local_only" })).status).toBe(200);
    const before = await projection();
    const beforeRequests = await requests(f.group.id);
    expect((await command(`${f.path}/${id}`, "DELETE")).status).toBe(409);
    expect(await projection()).toEqual(before);
    expect(await requests(f.group.id)).toEqual(beforeRequests);
  });

  it("does not attribute a concurrent join to the appointment's ignored seat insert", async () => {
    const f = await fixture({ publicLeadership: false, publicListing: true, withSeat: false, organization: true });
    let winningProjection: Awaited<ReturnType<typeof projection>> | undefined;
    let winningRequests: Awaited<ReturnType<typeof requests>> = [];
    const db = mutateBeforeNextBatch(env.DB, async () => {
      await joinGroup(env.DB, f.group.id, {
        actorUserId: f.person.userId,
        targetUserId: f.person.userId,
        selection: { mode: "selected", memberIds: [f.person.memberId] },
        source: "self_service",
        allowManaged: false,
      });
      winningProjection = await projection();
      winningRequests = await requests(f.group.id);
    });
    await assignLocalGroupLeadership(db, admin, f.group.id, {
      userId: f.person.userId,
      identityId: f.person.identityId,
      roleId: "role-group_lead",
    });
    expect(winningProjection).toBeDefined();
    expect(await projection()).toEqual(winningProjection);
    expect(await requests(f.group.id)).toEqual(winningRequests);
    expect(
      await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id=? AND user_id=?", [
        f.group.id,
        f.person.userId,
      ]),
    ).toHaveLength(1);
  });

  it("does not publish a repeated title and term", async () => {
    const f = await fixture();
    const id = await assign(f);
    const before = await projection();
    const beforeRequests = await requests(f.group.id);
    expect(
      (
        await command(`${f.path}/${id}`, "PATCH", {
          title: "Chair",
          startsAt: "2025-01-01T00:00:00.000Z",
          endsAt: null,
        })
      ).status,
    ).toBe(200);
    expect(await projection()).toEqual(before);
    expect(await requests(f.group.id)).toEqual(beforeRequests);
  });

  it.each([false, true])(
    "publishes an actual auto-created organization seat even with private leadership: %s",
    async (organization) => {
      const f = await fixture({ publicLeadership: false, publicListing: true, withSeat: false, organization });
      const before = await projection();
      const beforeRequests = await requests(f.group.id);
      await assign(f);
      expect(
        await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id=? AND user_id=?", [
          f.group.id,
          f.person.userId,
        ]),
      ).toHaveLength(1);
      if (organization) expect(await projection()).not.toEqual(before);
      else expect(await projection()).toEqual(before);
      expect(await requests(f.group.id)).toHaveLength(beforeRequests.length + Number(organization));
    },
  );

  it.each(
    ["assign", "update", "revoke"].flatMap((operation) =>
      ["request", "audit"].map((failure) => ({ operation, failure })),
    ),
  )("rolls back public $operation on $failure failure, then retries", async ({ operation, failure }) => {
    const f = await fixture({ withSeat: operation !== "assign" });
    const id = operation === "assign" ? null : await assign(f);
    const path = id ? `${f.path}/${id}` : f.path;
    const body =
      operation === "assign"
        ? { userId: f.person.userId, identityId: f.person.identityId, roleId: "role-group_lead" }
        : operation === "update"
          ? { title: "Retried Chair" }
          : undefined;
    const method = operation === "assign" ? "POST" : operation === "update" ? "PATCH" : "DELETE";
    const action = operation === "assign" ? "assigned" : operation === "update" ? "updated" : "revoked";
    const before = await projection();
    const beforeRequests = await requests(f.group.id);
    const seats = await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id=?", [f.group.id]);
    await env.DB.prepare(`CREATE TRIGGER fail_leadership_publication BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
        ${failure === "audit" ? `WHEN NEW.action='group_leadership_${action}'` : ""}
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_LEADERSHIP_PUBLICATION_FAILURE'); END`).run();
    try {
      expect((await command(path, method, body)).status).toBe(500);
      expect(await projection()).toEqual(before);
      expect(await requests(f.group.id)).toEqual(beforeRequests);
      expect(await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id=?", [f.group.id])).toEqual(seats);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_leadership_publication").run();
    }
    expect((await command(path, method, body)).status).toBe(operation === "assign" ? 201 : 200);
    expect(await projection()).not.toEqual(before);
    expect(await requests(f.group.id)).toHaveLength(beforeRequests.length + 1);
  });
});
