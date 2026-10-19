import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertOrgRepresentative } from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { validPngBytes } from "./helpers/raster-images";
import { resetDb } from "./helpers/reset-db";

let staff: string;
beforeEach(async () => {
  await resetDb();
  const { admin } = await seedEventAndAdmin(env.DB);
  staff = await createAdminSession(env.DB, admin.id, "group-user-profile-admin");
});
async function target(state = "roster") {
  const person = await insertOrgRepresentative(env.DB, { email: "group-user-profile@example.test" });
  await env.DB.prepare(
    "UPDATE identities SET hidden_from_public_profile=1,show_on_organization_profile=0,job_title='Group representative' WHERE id=?",
  )
    .bind(person.identityId)
    .run();
  await env.DB.prepare("UPDATE users SET first_name='Original',last_name='Contributor' WHERE id=?")
    .bind(person.userId)
    .run();
  await insertGroupSeat("group-user-profile", { publicRoster: ["roster", "past_roster"].includes(state) }, person);
  const groupId = await env.DB.prepare("SELECT id FROM groups WHERE slug='group-user-profile'").first<string>("id");
  await env.DB.prepare("UPDATE groups SET visibility='authenticated' WHERE id=?").bind(groupId).run();
  if (["inherited", "local_only", "past_leadership"].includes(state)) {
    if (state === "past_leadership")
      await env.DB.prepare("UPDATE groups SET public_leadership=1 WHERE id=?").bind(groupId).run();
    else
      await env.DB.prepare(`INSERT INTO groups(id,type_key,name,slug,parent_group_id,visibility,governance_inheritance_mode,public_leadership,active,created_at,updated_at)
      VALUES (?,'working_group','Inherited public user profile','group-user-child',?,'authenticated',?,1,1,?,?)`)
        .bind(crypto.randomUUID(), groupId, state === "local_only" ? "local_only" : "inherited", nowIso(), nowIso())
        .run();
    const role = await grantGroupLeadershipCapacity(env.DB, groupId!, person.userId);
    if (state === "past_leadership")
      await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE id=?").bind(nowIso(), role.roleAssignmentId).run();
  }
  if (state === "past_roster")
    await env.DB.prepare("UPDATE identities SET ended_at=?,updated_at=? WHERE id=?")
      .bind(nowIso(), nowIso(), person.identityId)
      .run();
  const owner = await createMemberSession(
    env.DB,
    person.userId,
    "group-user-profile-owner",
    undefined,
    person.identityId,
  );
  expect(await queryAll(env.DB, "SELECT slug FROM person_profile_slugs WHERE user_id=?", [person.userId])).toEqual([]);
  return { ...person, owner };
}
async function projection() {
  return (await readSitePublicationSnapshot(env.DB, [])).groups;
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_id,reason_code FROM site_publication_requests ORDER BY sequence");
function name(
  person: Awaited<ReturnType<typeof target>>,
  body = { firstName: "Updated", lastName: "Name" },
  owner = false,
) {
  return callApi(env, owner ? "/api/v1/users/current" : `/api/v1/users/${person.userId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${owner ? person.owner : staff}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function photo(person: Awaited<ReturnType<typeof target>>, remove = false) {
  return callApi({ ...env, IMAGES: undefined }, `/api/v1/users/${person.userId}/headshot`, {
    method: remove ? "DELETE" : "PUT",
    headers: { authorization: `Bearer ${staff}`, ...(remove ? {} : { "content-type": "image/png" }) },
    ...(remove ? {} : { body: validPngBytes() }),
  });
}
const key = (id: string) =>
  env.DB.prepare("SELECT headshot_r2_key FROM users WHERE id=?").bind(id).first<string>("headshot_r2_key");

describe("publication of group-only user names and portraits", () => {
  it.each(
    ["roster", "past_roster", "inherited", "past_leadership", "private", "local_only"].flatMap((state) =>
      ["name", "photo"].map((field) => ({ state, field })),
    ),
  )("captures actual group profile changes: %j", async ({ state, field }) => {
    const person = await target(state);
    const before = await projection();
    const count = (await requests()).length;
    const changed = !["private", "local_only"].includes(state);
    const response = field === "name" ? await name(person) : await photo(person);
    expect(response.status, await response.clone().text()).toBe(200);
    if (changed) expect(await projection()).not.toEqual(before);
    else expect(await projection()).toEqual(before);
    expect(await requests()).toHaveLength(count + Number(changed));
    if (changed)
      expect((await requests()).at(-1)).toMatchObject({
        resource_id: person.userId,
        reason_code: field === "name" ? "user_profile_changed" : "user_headshot_changed",
      });
    if (field === "name") {
      expect((await name(person)).status).toBe(200);
      expect(await requests()).toHaveLength(count + Number(changed));
    } else {
      const first = await key(person.userId);
      expect(await env.SPEAKER_UPLOADS_BUCKET!.head(first!)).not.toBeNull();
      expect((await photo(person)).status).toBe(200);
      const second = await key(person.userId);
      expect(second).not.toBe(first);
      expect(await env.SPEAKER_UPLOADS_BUCKET!.head(second!)).not.toBeNull();
      expect(await env.SPEAKER_UPLOADS_BUCKET!.head(first!)).toBeNull();
      expect(await requests()).toHaveLength(count + 2 * Number(changed));
      expect((await photo(person, true)).status).toBe(200);
      expect(await projection()).toEqual(before);
      expect(await env.SPEAKER_UPLOADS_BUCKET!.head(second!)).toBeNull();
      expect(await requests()).toHaveLength(count + 3 * Number(changed));
      expect((await photo(person, true)).status).toBe(200);
      expect(await requests()).toHaveLength(count + 3 * Number(changed));
    }
  });
  it("publishes owner name edits on public group profiles", async () => {
    const person = await target();
    const before = await projection();
    const count = (await requests()).length;
    const response = await name(person, undefined, true);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests()).toHaveLength(count + 1);
  });
  it("keeps preferred-name-only edits quiet when only group directories show the person", async () => {
    const person = await target();
    const before = await projection();
    const count = (await requests()).length;
    const response = await callApi(env, `/api/v1/users/${person.userId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${staff}`, "content-type": "application/json" },
      body: JSON.stringify({ preferredName: "Preferred" }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await projection()).toEqual(before);
    expect(await requests()).toHaveLength(count);
  });
  it.each(
    ["name", "upload", "remove"].flatMap((operation) =>
      ["request", "audit"].map((failure) => ({ operation, failure })),
    ),
  )("rolls back group $operation changes after $failure failure and retries", async ({ operation, failure }) => {
    const person = await target("inherited");
    if (operation === "remove") expect((await photo(person)).status).toBe(200);
    const before = await projection();
    const state = async () => ({
      user: await queryAll(env.DB, "SELECT first_name,last_name,headshot_r2_key,updated_at FROM users WHERE id=?", [
        person.userId,
      ]),
      audits: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
      requests: await requests(),
    });
    const persisted = await state();
    const objects = async () =>
      (await env.SPEAKER_UPLOADS_BUCKET!.list({ prefix: `headshots/${person.userId}/` })).objects
        .map((object) => object.key)
        .sort();
    const stored = await objects();
    const action =
      operation === "name" ? "user_updated" : operation === "upload" ? "headshot_uploaded" : "headshot_removed";
    await env.DB.prepare(`CREATE TRIGGER fail_group_user_profile BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
        WHEN ${failure === "request" ? "NEW.resource_type='user_profile'" : `NEW.action='${action}'`}
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_GROUP_USER_PROFILE_FAILURE'); END`).run();
    const mutate = () => (operation === "name" ? name(person) : photo(person, operation === "remove"));
    try {
      expect((await mutate()).status).toBe(500);
      expect(await projection()).toEqual(before);
      expect(await state()).toEqual(persisted);
      expect(await objects()).toEqual(stored);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_group_user_profile").run();
    }
    expect((await mutate()).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests()).toHaveLength(persisted.requests.length + 1);
  });
});
