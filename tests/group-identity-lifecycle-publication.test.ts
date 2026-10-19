import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupSchema } from "../assets/shared/schemas/groups";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { grantAdministrator } from "./helpers/administrator";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { addRepresentative, insertOrgRepresentative, insertUser } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

let staff: string;
async function command(path: string, method: string, body: unknown, token = staff) {
  return callApi(env, path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function createGroup(extra: Record<string, unknown> = {}) {
  const response = await command("/api/v1/groups", "POST", {
    typeKey: "working_group",
    name: "Identity group publication",
    slug: "identity-group-publication",
    visibility: "authenticated",
    ...extra,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return groupSchema.parse(((await response.json()) as { group: unknown }).group);
}
async function fixture(
  options: {
    publicRoster?: boolean;
    publicListing?: boolean;
    hidden?: boolean;
    inherited?: boolean;
    alternative?: boolean;
  } = {},
) {
  const person = await insertOrgRepresentative(env.DB, { email: "unaddressed-group-representative@example.test" });
  await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=?,show_on_organization_profile=0 WHERE id=?")
    .bind(options.hidden ? 1 : 0, person.identityId)
    .run();
  const group = await createGroup({
    publicRoster: options.publicRoster ?? true,
    visibility: options.publicListing ? "public" : "authenticated",
  });
  const seat = (userId: string) =>
    command(`/api/v1/groups/${group.id}/memberships/${userId}`, "POST", {
      capacitySelection: { mode: "selected", memberIds: [person.memberId] },
    });
  expect((await seat(person.userId)).status).toBe(200);
  if (options.alternative) {
    const other = await insertUser(env.DB, "remaining-group-representative@example.test");
    await addRepresentative(env.DB, person.memberId, other);
    expect((await seat(other)).status).toBe(200);
  }
  if (options.inherited) {
    await createGroup({
      name: "Inherited public identity leadership",
      slug: "inherited-public-identity-leadership",
      parentGroupId: group.id,
      publicLeadership: true,
    });
    await grantGroupLeadershipCapacity(env.DB, group.id, person.userId);
  }
  expect(await queryAll(env.DB, "SELECT slug FROM person_profile_slugs WHERE user_id=?", [person.userId])).toEqual([]);
  expect(
    await env.DB.prepare("SELECT show_on_organization_profile FROM identities WHERE id=?")
      .bind(person.identityId)
      .first("show_on_organization_profile"),
  ).toBe(0);
  const owner = await createMemberSession(
    env.DB,
    person.userId,
    "unaddressed-group-owner",
    undefined,
    person.identityId,
  );
  return {
    ...person,
    group,
    owner,
    path: `/api/v1/organizations/${person.organizationId}/identities/${person.identityId}`,
  };
}
async function projection() {
  const value = await readSitePublicationSnapshot(env.DB, []);
  return { groups: value.groups, members: value.groupMembers, people: value.people };
}
const requests = (id: string) =>
  queryAll(
    env.DB,
    "SELECT id FROM site_publication_requests WHERE resource_type='identity_profile' AND resource_id=? ORDER BY sequence",
    [id],
  );
function transition(f: Awaited<ReturnType<typeof fixture>>, state: string) {
  return command(f.path, "PATCH", { transition: { state, reason: "Reviewed group identity lifecycle" } });
}

beforeEach(async () => {
  await resetDb();
  const id = await insertUser(env.DB, "group-identity-staff@example.test");
  await grantAdministrator(env.DB, id);
  staff = await createAdminSession(env.DB, id, "group-identity-staff-token");
});

describe("publication of unaddressed organization identity group effects", () => {
  it.each([
    { publicRoster: true, changed: true },
    { publicRoster: true, hidden: true, changed: true },
    { publicRoster: false, publicListing: true, changed: true },
    { publicRoster: false, publicListing: true, alternative: true, changed: false },
    { publicRoster: false, inherited: true, changed: true },
    { publicRoster: false, changed: false },
  ])("publishes actual group changes independently of person/member profiles: %j", async ({ changed, ...options }) => {
    const f = await fixture(options);
    const before = await projection();
    const count = (await requests(f.identityId)).length;
    const response = await transition(f, "ended");
    expect(response.status, await response.clone().text()).toBe(200);
    if (changed) expect(await projection()).not.toEqual(before);
    else expect(await projection()).toEqual(before);
    expect(await requests(f.identityId)).toHaveLength(count + Number(changed));
  });
  it.each([false, true])("publishes restoration of actual public group data (hidden=%s)", async (hidden) => {
    const f = await fixture({ hidden });
    expect((await transition(f, "ended")).status).toBe(200);
    const before = await projection();
    const count = (await requests(f.identityId)).length;
    const response = await transition(f, "active");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests(f.identityId)).toHaveLength(count + 1);
    expect(await queryAll(env.DB, "SELECT slug FROM person_profile_slugs WHERE user_id=?", [f.userId])).toEqual([]);
  });

  it.each(["blocked", "owner-ended"])("publishes public group withdrawal through %s", async (state) => {
    const f = await fixture();
    const before = await projection();
    const count = (await requests(f.identityId)).length;
    const response =
      state === "blocked"
        ? await transition(f, state)
        : await command(
            `/api/v1/users/current/identities/${f.identityId}`,
            "PATCH",
            { transition: { state: "ended" } },
            f.owner,
          );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests(f.identityId)).toHaveLength(count + 1);
  });

  it.each(
    ["ended", "blocked", "restore", "owner-ended"].flatMap((operation) =>
      ["request", "audit"].map((failure) => ({ operation, failure })),
    ),
  )("rolls back group effects of $operation after $failure failure and retries", async ({ operation, failure }) => {
    const f = await fixture({ hidden: true });
    if (operation === "restore") expect((await transition(f, "ended")).status).toBe(200);
    const before = await projection();
    const readState = async () => ({
      identities: await queryAll(
        env.DB,
        "SELECT id,ended_at,blocked_at,updated_at FROM identities WHERE user_id=? ORDER BY id",
        [f.userId],
      ),
      seats: await queryAll(
        env.DB,
        "SELECT id,group_id,left_at,updated_at FROM group_memberships WHERE user_id=? ORDER BY id",
        [f.userId],
      ),
      audits: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
      requests: await queryAll(env.DB, "SELECT id FROM site_publication_requests ORDER BY sequence"),
    });
    const persisted = await readState();
    const identityRequests = (await requests(f.identityId)).length;
    const action =
      operation === "restore"
        ? "organization_identity_reinstated"
        : operation === "blocked"
          ? "organization_identity_blocked"
          : "organization_identity_ended";
    await env.DB.prepare(`CREATE TRIGGER fail_group_identity_publication BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
        WHEN ${failure === "request" ? "NEW.resource_type='identity_profile'" : `NEW.action='${action}'`}
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_GROUP_IDENTITY_PUBLICATION_FAILURE'); END`).run();
    const mutate = () =>
      operation === "owner-ended"
        ? command(
            `/api/v1/users/current/identities/${f.identityId}`,
            "PATCH",
            { transition: { state: "ended" } },
            f.owner,
          )
        : transition(f, operation === "restore" ? "active" : operation);
    try {
      expect((await mutate()).status).toBe(500);
      expect(await projection()).toEqual(before);
      expect(await readState()).toEqual(persisted);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_group_identity_publication").run();
    }
    expect((await mutate()).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests(f.identityId)).toHaveLength(identityRequests + 1);
  });
});
