import { serializeLinks } from "../assets/shared/schemas/links";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { addRepresentative, insertOrgRepresentative, insertUser } from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";

let staff: string;
beforeEach(async () => {
  await resetDb();
  const setup = await seedEventAndAdmin(env.DB);
  staff = await createAdminSession(env.DB, setup.admin.id, "group-user-lifecycle-admin");
});

async function target(state: string) {
  const person = await insertOrgRepresentative(env.DB, { email: "unaddressed-group-account@example.test" });
  await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1,show_on_organization_profile=0 WHERE id=?")
    .bind(person.identityId)
    .run();
  await env.DB.prepare("UPDATE users SET first_name='Public',last_name='Contributor' WHERE id=?")
    .bind(person.userId)
    .run();
  await insertGroupSeat(
    "account-lifecycle",
    { publicRoster: ["roster", "past", "blank", "title", "links", "legacy_links", "photo"].includes(state) },
    person,
  );
  const groupId = await env.DB.prepare("SELECT id FROM groups WHERE slug='account-lifecycle'").first<string>("id");
  await env.DB.prepare("UPDATE groups SET visibility=? WHERE id=?")
    .bind(["organization", "alternative"].includes(state) ? "public" : "authenticated", groupId)
    .run();
  if (state === "alternative") {
    const other = await insertUser(env.DB, "remaining-account-representative@example.test");
    await addRepresentative(env.DB, person.memberId, other);
    await env.DB.prepare(`INSERT INTO group_memberships(id,group_id,user_id,identity_id,member_id,source,joined_at,created_at,updated_at)
      SELECT ?,?,?,id,?,'staff',?,?,? FROM identities WHERE user_id=? AND organization_id=?`)
      .bind(
        crypto.randomUUID(),
        groupId,
        other,
        person.memberId,
        nowIso(),
        nowIso(),
        nowIso(),
        other,
        person.organizationId,
      )
      .run();
  }
  if (["leadership", "past_leadership", "inherited"].includes(state)) {
    if (state === "inherited") {
      await env.DB.prepare(`INSERT INTO groups(id,type_key,name,slug,parent_group_id,visibility,public_leadership,active,created_at,updated_at)
        VALUES (?,'working_group','Inherited account leadership','account-child',?,'authenticated',1,1,?,?)`)
        .bind(crypto.randomUUID(), groupId, nowIso(), nowIso())
        .run();
    } else await env.DB.prepare("UPDATE groups SET public_leadership=1 WHERE id=?").bind(groupId).run();
    await grantGroupLeadershipCapacity(env.DB, groupId!, person.userId);
  }
  if (["past", "past_leadership", "blank", "title", "links", "legacy_links", "photo"].includes(state)) {
    await env.DB.prepare("UPDATE identities SET ended_at=?,updated_at=? WHERE id=?")
      .bind(nowIso(), nowIso(), person.identityId)
      .run();
  }
  if (["blank", "title", "links", "legacy_links", "photo"].includes(state)) {
    await env.DB.prepare("UPDATE users SET first_name=NULL,last_name=NULL,preferred_name=NULL WHERE id=?")
      .bind(person.userId)
      .run();
    await env.DB.prepare("UPDATE identities SET job_title=NULL,biography=NULL,links_json=NULL WHERE user_id=?")
      .bind(person.userId)
      .run();
    if (state === "title")
      await env.DB.prepare("UPDATE identities SET job_title='Published title' WHERE id=?")
        .bind(person.identityId)
        .run();
    if (state === "links")
      await env.DB.prepare("UPDATE identities SET links_json=? WHERE id=?")
        .bind(serializeLinks(["https://example.test/profile"]), person.identityId)
        .run();
    if (state === "legacy_links")
      await env.DB.prepare("UPDATE identities SET links_json=? WHERE id=?")
        .bind(JSON.stringify({ website: "https://example.test/legacy-profile" }), person.identityId)
        .run();
    if (state === "photo")
      await env.DB.prepare("UPDATE users SET headshot_r2_key='headshots/synthetic-group-user.png' WHERE id=?")
        .bind(person.userId)
        .run();
  }
  await createMemberSession(env.DB, person.userId, "group-account-owner", undefined, null);
  expect(await queryAll(env.DB, "SELECT slug FROM person_profile_slugs WHERE user_id=?", [person.userId])).toEqual([]);
  return person;
}
async function projection() {
  const snapshot = await readSitePublicationSnapshot(env.DB, []);
  return { groups: snapshot.groups, members: snapshot.groupMembers, people: snapshot.people };
}
const requests = () => queryAll(env.DB, "SELECT id,resource_id FROM site_publication_requests ORDER BY sequence");
function act(userId: string, operation: string) {
  return callApi(env, `/api/v1/users/${userId}${operation === "anonymize" ? "/anonymize" : ""}`, {
    method: operation === "anonymize" ? "POST" : "PATCH",
    headers: { authorization: `Bearer ${staff}`, "content-type": "application/json" },
    ...(operation === "anonymize" ? {} : { body: JSON.stringify({ active: false }) }),
  });
}

describe("publication of unaddressed account group effects", () => {
  it.each(
    ["deactivate", "anonymize"].flatMap((operation) =>
      [
        "roster",
        "organization",
        "alternative",
        "leadership",
        "inherited",
        "private",
        "past",
        "past_leadership",
        "blank",
        "title",
        "links",
        "legacy_links",
        "photo",
      ].map((state) => ({ operation, state })),
    ),
  )("captures actual public group changes: %j", async ({ operation, state }) => {
    const person = await target(state);
    const before = await projection();
    const count = (await requests()).length;
    const changed =
      ["roster", "organization", "leadership", "inherited"].includes(state) ||
      (operation === "anonymize" &&
        ["past", "past_leadership", "title", "links", "legacy_links", "photo"].includes(state));
    const response = await act(person.userId, operation);
    expect(response.status, await response.clone().text()).toBe(200);
    if (changed) expect(await projection()).not.toEqual(before);
    else expect(await projection()).toEqual(before);
    expect(await requests()).toHaveLength(count + Number(changed));
    expect((await act(person.userId, operation)).status).toBe(operation === "anonymize" ? 409 : 200);
    expect(await requests()).toHaveLength(count + Number(changed));
  });

  it.each(
    ["deactivate", "anonymize"].flatMap((operation) => ["request", "audit"].map((failure) => ({ operation, failure }))),
  )(
    "rolls back account/group changes after $failure failure and retries $operation",
    async ({ operation, failure }) => {
      const person = await target("roster");
      const before = await projection();
      const state = async () => ({
        user: await queryAll(
          env.DB,
          "SELECT active,first_name,last_name,pii_redacted_at,updated_at FROM users WHERE id=?",
          [person.userId],
        ),
        identities: await queryAll(
          env.DB,
          "SELECT id,ended_at,job_title,links_json,updated_at FROM identities WHERE user_id=? ORDER BY id",
          [person.userId],
        ),
        seats: await queryAll(
          env.DB,
          "SELECT id,left_at,updated_at FROM group_memberships WHERE user_id=? ORDER BY id",
          [person.userId],
        ),
        sessions: await queryAll(env.DB, "SELECT id,revoked_at FROM sessions WHERE user_id=? ORDER BY id", [
          person.userId,
        ]),
        audits: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
        requests: await requests(),
      });
      const persisted = await state();
      const action = operation === "anonymize" ? "user_anonymized" : "user_updated";
      await env.DB.prepare(`CREATE TRIGGER fail_group_account BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
        WHEN ${failure === "request" ? "NEW.resource_type='user_profile'" : `NEW.action='${action}'`}
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_GROUP_ACCOUNT_FAILURE'); END`).run();
      try {
        expect((await act(person.userId, operation)).status).toBe(500);
        expect(await projection()).toEqual(before);
        expect(await state()).toEqual(persisted);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_group_account").run();
      }
      expect((await act(person.userId, operation)).status).toBe(200);
      expect(await projection()).not.toEqual(before);
      expect(await requests()).toHaveLength(persisted.requests.length + 1);
    },
  );
});
