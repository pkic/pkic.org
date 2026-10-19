import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { addRepresentative, insertIndividualMember, insertOrgRepresentative, insertUser } from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";

let staff: string;
beforeEach(async () => {
  await resetDb();
  const setup = await seedEventAndAdmin(env.DB);
  staff = await createAdminSession(env.DB, setup.admin.id, "capacity-removal-publication-admin");
});
async function target(state: string) {
  const person = ["person", "inactive_private"].includes(state)
    ? await insertIndividualMember(env.DB, "H6", "capacity-person@example.test")
    : await insertOrgRepresentative(env.DB, { email: "capacity-representative@example.test" });
  await env.DB.prepare("UPDATE identities SET show_on_organization_profile=?,hidden_from_public_profile=? WHERE id=?")
    .bind(state === "overlap" ? 1 : 0, ["person", "overlap"].includes(state) ? 0 : 1, person.identityId)
    .run();
  await insertGroupSeat(
    "capacity-publication",
    { publicRoster: ["roster", "person", "overlap"].includes(state) },
    person,
  );
  const groupId = await env.DB.prepare("SELECT id FROM groups WHERE slug='capacity-publication'").first<string>("id");
  await env.DB.prepare("UPDATE groups SET visibility=? WHERE id=?")
    .bind(["organization", "alternative"].includes(state) ? "public" : "authenticated", groupId)
    .run();
  if (state === "alternative") {
    const other = await insertUser(env.DB, "alternative-capacity@example.test");
    await addRepresentative(env.DB, person.memberId, other);
    await env.DB.prepare(`INSERT INTO group_memberships(id,group_id,user_id,identity_id,member_id,source,joined_at,created_at,updated_at)
      SELECT ?,?,?,id,?,'staff',?,?,? FROM identities WHERE user_id=?`)
      .bind(crypto.randomUUID(), groupId, other, person.memberId, nowIso(), nowIso(), nowIso(), other)
      .run();
  }
  if (state === "inherited") {
    await env.DB.prepare(`INSERT INTO groups(id,type_key,name,slug,parent_group_id,visibility,public_leadership,active,created_at,updated_at)
      VALUES (?,'working_group','Inherited capacity leadership','capacity-child',?,'authenticated',1,1,?,?)`)
      .bind(crypto.randomUUID(), groupId, nowIso(), nowIso())
      .run();
    await grantGroupLeadershipCapacity(env.DB, groupId!, person.userId);
  }
  if (["person", "inactive_private"].includes(state)) {
    await env.DB.prepare("UPDATE group_memberships SET left_at=?,updated_at=? WHERE user_id=?")
      .bind(nowIso(), nowIso(), person.userId)
      .run();
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(person.memberId).run();
  }
  if (state === "person") await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  expect(
    (await queryAll(env.DB, "SELECT slug FROM person_profile_slugs WHERE user_id=?", [person.userId])).length,
  ).toBe(state === "person" ? 1 : 0);
  return person;
}
async function projection() {
  return readSitePublicationSnapshot(env.DB, []);
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_type,resource_id,reason_code FROM site_publication_requests ORDER BY sequence");
function remove(identityId: string) {
  return callApi(env, `/api/v1/members/capacities/${identityId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${staff}` },
  });
}
describe("publication after member capacity removal", () => {
  it.each(["roster", "organization", "inherited", "private", "alternative", "person", "inactive_private", "overlap"])(
    "captures the actual public withdrawal for %s",
    async (state) => {
      const person = await target(state);
      const before = await projection();
      const count = (await requests()).length;
      const changed = !["private", "alternative", "inactive_private"].includes(state);
      const response = await remove(person.identityId);
      expect(response.status, await response.clone().text()).toBe(200);
      if (changed) expect(await projection()).not.toEqual(before);
      else expect(await projection()).toEqual(before);
      const after = await requests();
      expect(after).toHaveLength(count + Number(changed));
      if (changed)
        expect(after.at(-1)).toMatchObject({
          resource_type: "membership",
          resource_id: person.memberId,
          reason_code: "membership_changed",
        });
      expect((await remove(person.identityId)).status).toBe(404);
      expect(await requests()).toEqual(after);
    },
  );
  it.each(["request", "audit"])("rolls back removal after %s failure and retries", async (failure) => {
    const person = await target("roster");
    const before = await projection();
    const state = async () => ({
      identities: await queryAll(env.DB, "SELECT id,ended_at,updated_at FROM identities WHERE user_id=? ORDER BY id", [
        person.userId,
      ]),
      seats: await queryAll(env.DB, "SELECT id,left_at,updated_at FROM group_memberships WHERE user_id=? ORDER BY id", [
        person.userId,
      ]),
      audits: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
      requests: await requests(),
    });
    const persisted = await state();
    await env.DB.prepare(`CREATE TRIGGER fail_capacity_publication BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
      WHEN ${failure === "request" ? "NEW.resource_type='membership'" : "NEW.action='identity_ended'"}
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CAPACITY_PUBLICATION_FAILURE'); END`).run();
    try {
      expect((await remove(person.identityId)).status).toBe(500);
      expect(await projection()).toEqual(before);
      expect(await state()).toEqual(persisted);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_capacity_publication").run();
    }
    expect((await remove(person.identityId)).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests()).toHaveLength(persisted.requests.length + 1);
  });
});
