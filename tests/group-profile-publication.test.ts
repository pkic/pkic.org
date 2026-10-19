import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertIndividualMember, insertOrgRepresentative } from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";

let staff: string;
beforeEach(async () => {
  await resetDb();
  const { admin } = await seedEventAndAdmin(env.DB);
  staff = await createAdminSession(env.DB, admin.id, "group-profile-admin");
});
async function target(state: string, personal = false) {
  const person = personal
    ? await insertIndividualMember(env.DB, "H6", "group-profile-individual@example.test")
    : await insertOrgRepresentative(env.DB, { email: "group-profile-representative@example.test" });
  await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1,show_on_organization_profile=0 WHERE id=?")
    .bind(person.identityId)
    .run();
  if (!personal)
    await env.DB.prepare("UPDATE identities SET job_title='Original group title' WHERE id=?")
      .bind(person.identityId)
      .run();
  await insertGroupSeat(
    "group-profile",
    { publicRoster: ["roster", "past_roster", "inactive_group"].includes(state) },
    person,
  );
  const groupId = await env.DB.prepare("SELECT id FROM groups WHERE slug='group-profile'").first<string>("id");
  await env.DB.prepare("UPDATE groups SET visibility='authenticated' WHERE id=?").bind(groupId).run();
  if (
    [
      "leadership",
      "past_leadership",
      "expired_leadership",
      "expired_inherited",
      "inherited",
      "local_only",
      "inactive_member",
      "inactive_ancestor",
    ].includes(state)
  ) {
    if (["inherited", "local_only", "inactive_ancestor", "expired_inherited"].includes(state)) {
      await env.DB.prepare(`INSERT INTO groups(id,type_key,name,slug,parent_group_id,visibility,governance_inheritance_mode,public_leadership,active,created_at,updated_at)
        VALUES (?,'working_group','Public inherited profile','group-profile-child',?,'authenticated',?,1,1,?,?)`)
        .bind(crypto.randomUUID(), groupId, state === "local_only" ? "local_only" : "inherited", nowIso(), nowIso())
        .run();
    } else await env.DB.prepare("UPDATE groups SET public_leadership=1 WHERE id=?").bind(groupId).run();
    const role = await grantGroupLeadershipCapacity(env.DB, groupId!, person.userId);
    if (state === "past_leadership")
      await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE id=?").bind(nowIso(), role.roleAssignmentId).run();
    if (["expired_leadership", "expired_inherited"].includes(state))
      await env.DB.prepare(
        "UPDATE user_roles SET created_at='2020-01-01T00:00:00.000Z',expires_at='2021-01-01T00:00:00.000Z' WHERE id=?",
      )
        .bind(role.roleAssignmentId)
        .run();
  }
  if (state === "past_roster")
    await env.DB.prepare("UPDATE group_memberships SET left_at=?,updated_at=? WHERE group_id=?")
      .bind(nowIso(), nowIso(), groupId)
      .run();
  if (["inactive_group", "inactive_ancestor"].includes(state))
    await env.DB.prepare("UPDATE groups SET active=0 WHERE id=?").bind(groupId).run();
  if (personal || state === "inactive_member")
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(person.memberId).run();
  const owner = await createMemberSession(env.DB, person.userId, "group-profile-owner", undefined, person.identityId);
  expect(await queryAll(env.DB, "SELECT slug FROM person_profile_slugs WHERE user_id=?", [person.userId])).toEqual([]);
  return { ...person, owner };
}
async function projection() {
  return (await readSitePublicationSnapshot(env.DB, [])).groups;
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_type,resource_id FROM site_publication_requests ORDER BY sequence");
function patch(person: Awaited<ReturnType<typeof target>>, body: unknown, mode = "staff") {
  const path =
    mode === "owner"
      ? `/api/v1/users/current/identities/${person.identityId}/profile`
      : mode === "capacity"
        ? `/api/v1/members/capacities/${person.identityId}`
        : mode === "organization" && "organizationId" in person
          ? `/api/v1/organizations/${person.organizationId}/identities/${person.identityId}`
          : `/api/v1/identities/${person.identityId}`;
  return callApi(env, path, {
    method: "PATCH",
    headers: { authorization: `Bearer ${mode === "owner" ? person.owner : staff}`, "content-type": "application/json" },
    body: JSON.stringify(["capacity", "organization"].includes(mode) ? { profile: body } : body),
  });
}

describe("publication after group-only identity profile edits", () => {
  it.each(
    [
      "roster",
      "past_roster",
      "leadership",
      "past_leadership",
      "expired_leadership",
      "expired_inherited",
      "inherited",
      "local_only",
      "private",
      "inactive_group",
      "inactive_member",
      "inactive_ancestor",
    ].flatMap((state) => ["links", "jobTitle"].map((field) => ({ state, field }))),
  )("captures actual public group profile changes: %j", async ({ state, field }) => {
    const person = await target(state);
    const before = await projection();
    const count = (await requests()).length;
    const changed = !["local_only", "private", "inactive_group", "inactive_member", "expired_inherited"].includes(
      state,
    );
    const value = field === "links" ? ["https://example.test/group-profile"] : "Published group title";
    const response = await patch(person, { [field]: value });
    expect(response.status, await response.clone().text()).toBe(200);
    if (changed) expect(await projection()).not.toEqual(before);
    else expect(await projection()).toEqual(before);
    expect(await requests()).toHaveLength(count + Number(changed));
    expect((await patch(person, { [field]: value })).status).toBe(200);
    expect(await requests()).toHaveLength(count + Number(changed));
    expect((await patch(person, { [field]: field === "links" ? [] : "Original group title" })).status).toBe(200);
    expect(await projection()).toEqual(before);
    expect(await requests()).toHaveLength(count + 2 * Number(changed));
  });
  it.each(["owner", "organization", "capacity"])("uses the same group link detector through %s", async (mode) => {
    const person = await target("roster", mode === "capacity");
    const before = await projection();
    const count = (await requests()).length;
    const response = await patch(person, { links: ["https://example.test/other-caller"] }, mode);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests()).toHaveLength(count + 1);
    expect((await requests()).at(-1)).toMatchObject({
      resource_type: mode === "capacity" ? "membership" : "identity_profile",
      resource_id: mode === "capacity" ? person.memberId : person.identityId,
    });
  });
  it("keeps secondary-link edits quiet and publishes a reordered featured link", async () => {
    const person = await target("roster");
    const first = "https://example.test/featured";
    expect((await patch(person, { links: [first, "https://example.test/secondary"] })).status).toBe(200);
    const before = await projection();
    const count = (await requests()).length;
    const second = "https://example.test/edited-secondary";
    expect((await patch(person, { links: [first, second] })).status).toBe(200);
    expect(await projection()).toEqual(before);
    expect(await requests()).toHaveLength(count);
    expect((await patch(person, { links: [second, first] })).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests()).toHaveLength(count + 1);
  });
  it("keeps an individual title edit quiet when groups show its membership category", async () => {
    const person = await target("roster", true);
    const before = await projection();
    const count = (await requests()).length;
    expect((await patch(person, { jobTitle: "Personal researcher" })).status).toBe(200);
    expect(await projection()).toEqual(before);
    expect(await requests()).toHaveLength(count);
  });
  it.each(["links", "jobTitle"].flatMap((field) => ["request", "audit"].map((failure) => ({ field, failure }))))(
    "rolls back group $field changes after $failure failure and retries",
    async ({ field, failure }) => {
      const person = await target("inherited");
      const before = await projection();
      const state = async () => ({
        identity: await queryAll(env.DB, "SELECT job_title,links_json,updated_at FROM identities WHERE id=?", [
          person.identityId,
        ]),
        audits: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
        requests: await requests(),
      });
      const persisted = await state();
      await env.DB.prepare(`CREATE TRIGGER fail_group_profile BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
        WHEN ${failure === "request" ? "NEW.resource_type='identity_profile'" : "NEW.entity_type='identity'"}
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_GROUP_PROFILE_FAILURE'); END`).run();
      const body = { [field]: field === "links" ? ["https://example.test/retry-profile"] : "Retry group title" };
      try {
        expect((await patch(person, body)).status).toBe(500);
        expect(await projection()).toEqual(before);
        expect(await state()).toEqual(persisted);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_group_profile").run();
      }
      expect((await patch(person, body)).status).toBe(200);
      expect(await projection()).not.toEqual(before);
      expect(await requests()).toHaveLength(persisted.requests.length + 1);
    },
  );
});
