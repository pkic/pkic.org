import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthAdmin } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { queueExpiredGroupLeadershipPublication } from "../functions/_lib/services/groups/leadership-expiry-publication";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import {
  revokeUserRoleAssignment,
  updateUserRoleAssignmentExpiry,
} from "../functions/_lib/services/access-control/user-role-assignments";
import { administratorGrants, grantAdministrator } from "./helpers/administrator";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertIndividualMember, insertUser } from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";

let token: string;
let actor: AuthAdmin;
beforeEach(async () => {
  await resetDb();
  const userId = await insertUser(env.DB, "access-publication-admin@example.test");
  await grantAdministrator(env.DB, userId);
  token = await createAdminSession(env.DB, userId, "access-publication-admin");
  actor = {
    identityType: "user",
    id: userId,
    email: "access-publication-admin@example.test",
    grants: administratorGrants,
  };
});
async function fixture(mode = "local", expiresAt: string | null = null) {
  const person = await insertIndividualMember(env.DB);
  const slug = `access-publication-${crypto.randomUUID()}`;
  await insertGroupSeat(slug, { publicRoster: mode === "roster" }, person);
  const groupId = (await env.DB.prepare("SELECT id FROM groups WHERE slug=?").bind(slug).first<string>("id"))!;
  await env.DB.prepare("UPDATE groups SET visibility='authenticated',public_leadership=? WHERE id=?")
    .bind(Number(mode === "local"), groupId)
    .run();
  if (mode === "inherited")
    await env.DB.prepare(`INSERT INTO groups(id,type_key,name,slug,parent_group_id,visibility,governance_inheritance_mode,public_leadership,active,created_at,updated_at)
      VALUES(?,'working_group','Inherited access publication',?,?,'authenticated','inherited',1,1,?,?)`)
      .bind(crypto.randomUUID(), `${slug}-child`, groupId, nowIso(), nowIso())
      .run();
  const role = await grantGroupLeadershipCapacity(env.DB, groupId, person.userId);
  await env.DB.prepare(
    "UPDATE user_roles SET title='Chair',starts_at='2020-01-01T00:00:00.000Z',expires_at=? WHERE id=?",
  )
    .bind(expiresAt, role.roleAssignmentId)
    .run();
  return { ...person, groupId, roleId: role.roleAssignmentId };
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_type,resource_id,reason_code FROM site_publication_requests ORDER BY sequence");
const roleState = (id: string) => queryAll(env.DB, "SELECT id,expires_at,revoked_at FROM user_roles WHERE id=?", [id]);
const audits = (id: string) => queryAll(env.DB, "SELECT id,action FROM audit_log WHERE entity_id=? ORDER BY id", [id]);
const projection = async () => (await readSitePublicationSnapshot(env.DB, [])).groups;
async function command(
  f: Awaited<ReturnType<typeof fixture>>,
  method: "PATCH" | "DELETE",
  expiresAt: string | null = null,
  auth = token,
) {
  return callApi(env, `/api/v1/users/${f.userId}/roles/${f.roleId}`, {
    method,
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    ...(method === "PATCH" ? { body: JSON.stringify({ expiresAt }) } : {}),
  });
}
describe("publication after access-control leadership changes", () => {
  it.each(["roster", "inherited"].flatMap((mode) => ["revoke", "reopen"].map((operation) => ({ mode, operation }))))(
    "publishes public effects outside local leadership: %j",
    async ({ mode, operation }) => {
      const f = await fixture(mode, operation === "reopen" ? "2021-01-01T00:00:00.000Z" : null);
      const before = await projection();
      const response = await command(f, operation === "revoke" ? "DELETE" : "PATCH");
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await projection()).not.toEqual(before);
      expect(await requests()).toHaveLength(1);
      expect((await requests())[0]).toMatchObject({ resource_type: "group_content", resource_id: f.groupId });
    },
  );
  it.each([null, "2035-01-01T00:00:00.000Z"])("does not publish an unchanged expiry %s", async (expiresAt) => {
    const f = await fixture("local", expiresAt);
    const before = await roleState(f.roleId);
    expect((await command(f, "PATCH", expiresAt)).status).toBe(200);
    expect(await roleState(f.roleId)).toEqual(before);
    expect(await requests()).toEqual([]);
  });
  it.each(["PATCH", "DELETE"] as const)("leaves unrelated global role %s mutations quiet", async (method) => {
    const f = await fixture();
    const roleId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO user_roles(id,user_id,role_id,context_type,context_id,single_holder_per_context,created_at)
      VALUES(?,?,'role-membership_processor',NULL,NULL,0,?)`)
      .bind(roleId, f.userId, nowIso())
      .run();
    expect((await command({ ...f, roleId }, method, "2035-01-01T00:00:00.000Z")).status).toBe(200);
    expect(await requests()).toEqual([]);
  });
  it.each([false, true])(
    "preserves unreported late expiry without duplicating recorded withdrawal: %s",
    async (reported) => {
      const f = await fixture("inherited", "2021-01-01T00:00:00.000Z");
      if (reported) expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(1);
      const recorded = await requests();
      expect((await command(f, "DELETE")).status).toBe(200);
      expect(await requests()).toHaveLength(1);
      if (reported) expect(await requests()).toEqual(recorded);
      expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(0);
    },
  );
  it.each(["PATCH", "DELETE"] as const)(
    "refuses unauthorized %s without a role or publication change",
    async (method) => {
      const f = await fixture();
      const before = await roleState(f.roleId);
      const userId = await insertUser(env.DB, "access-publication-nonstaff@example.test");
      const otherToken = await createAdminSession(env.DB, userId, "access-publication-nonstaff");
      expect((await command(f, method, "2035-01-01T00:00:00.000Z", otherToken)).status).toBe(403);
      expect(await roleState(f.roleId)).toEqual(before);
      expect(await requests()).toEqual([]);
      expect(await audits(f.roleId)).toEqual([]);
    },
  );
  it.each(
    ["PATCH", "DELETE"].flatMap((method) =>
      ["request", "audit"].map((failure) => ({ method: method as "PATCH" | "DELETE", failure })),
    ),
  )("rolls back and retries the complete mutation: %j", async ({ method, failure }) => {
    const f = await fixture("inherited");
    const before = await roleState(f.roleId);
    const delivery = await queryAll(
      env.DB,
      "SELECT desired_sequence,delivered_sequence FROM site_publication_delivery_state",
    );
    const trigger =
      failure === "request"
        ? "CREATE TRIGGER fail_access_publication BEFORE INSERT ON site_publication_requests BEGIN SELECT RAISE(ABORT,'SYNTHETIC_ACCESS_PUBLICATION_FAILURE'); END"
        : "CREATE TRIGGER fail_access_publication BEFORE INSERT ON audit_log WHEN NEW.action IN ('user_role_revoked','user_role_expiry_updated') BEGIN SELECT RAISE(ABORT,'SYNTHETIC_ACCESS_PUBLICATION_FAILURE'); END";
    await env.DB.prepare(trigger).run();
    try {
      expect((await command(f, method, "2035-01-01T00:00:00.000Z")).status).toBe(500);
      expect(await roleState(f.roleId)).toEqual(before);
      expect(await requests()).toEqual([]);
      expect(await audits(f.roleId)).toEqual([]);
      expect(
        await queryAll(env.DB, "SELECT desired_sequence,delivered_sequence FROM site_publication_delivery_state"),
      ).toEqual(delivery);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_access_publication").run();
    }
    expect((await command(f, method, "2035-01-01T00:00:00.000Z")).status).toBe(200);
    expect(await requests()).toHaveLength(1);
    expect(await audits(f.roleId)).toHaveLength(1);
  });
  it.each(["PATCH", "DELETE"].flatMap((method) => ["authority", "target"].map((race) => ({ method, race }))))(
    "rolls back publication when preflight changes: %j",
    async ({ method, race }) => {
      const f = await fixture();
      const raced = mutateBeforeNextBatch(env.DB, async () => {
        if (race === "authority")
          await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), actor.id).run();
        else if (method === "PATCH")
          await env.DB.prepare("UPDATE user_roles SET expires_at='2034-01-01T00:00:00.000Z' WHERE id=?")
            .bind(f.roleId)
            .run();
        else await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE id=?").bind(nowIso(), f.roleId).run();
      });
      const pending =
        method === "PATCH"
          ? updateUserRoleAssignmentExpiry(raced, actor, f.userId, f.roleId, { expiresAt: "2035-01-01T00:00:00.000Z" })
          : revokeUserRoleAssignment(raced, actor, f.userId, f.roleId);
      await expect(pending).rejects.toMatchObject({
        status: 409,
        code: race === "authority" ? "ACCESS_CONTROL_AUTHORIZATION_CHANGED" : "ACCESS_CONTROL_TARGET_CHANGED",
      });
      expect(await requests()).toEqual([]);
      expect(await audits(f.roleId)).toEqual([]);
      const [row] = await roleState(f.roleId);
      if (race === "authority") expect(row).toMatchObject({ expires_at: null, revoked_at: null });
      else if (method === "PATCH")
        expect(row).toMatchObject({ expires_at: "2034-01-01T00:00:00.000Z", revoked_at: null });
      else expect(row!.revoked_at).not.toBeNull();
    },
  );

  it.each(["revoke", "schedule", "reopen"])(
    "publishes a public leadership %s through the user-role endpoint",
    async (operation) => {
      const f = await fixture("local", operation === "reopen" ? "2021-01-01T00:00:00.000Z" : null);
      const before = await projection();
      const response = await command(
        f,
        operation === "revoke" ? "DELETE" : "PATCH",
        operation === "schedule" ? "2035-01-01T00:00:00.000Z" : null,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await projection()).not.toEqual(before);
      expect(await requests()).toEqual([
        expect.objectContaining({
          resource_type: "group_content",
          resource_id: f.groupId,
          reason_code: "group_content_changed",
        }),
      ]);
    },
  );
  it("leaves a private leadership change quiet", async () => {
    const f = await fixture("private");
    expect((await command(f, "DELETE")).status).toBe(200);
    expect(await requests()).toEqual([]);
  });
});
