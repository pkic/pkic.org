import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { mergeOrganizations } from "../functions/_lib/services/organization-management/merge";
import { queueExpiredGroupLeadershipPublication } from "../functions/_lib/services/groups/leadership-expiry-publication";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { nowIso } from "../functions/_lib/utils/time";
import { administratorGrants, grantAdministrator } from "./helpers/administrator";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { ensureGroupMembershipCapacity, grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import {
  insertIndividualMembershipForUser,
  insertOrganization,
  insertOrgRepresentative,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeNextBatch } from "./helpers/database-races";

let token: string;
let actor: UserBackedAuthAdmin;
beforeEach(async () => {
  await resetDb();
  const actorId = await insertUser(env.DB, "group-merge-admin@example.test");
  await grantAdministrator(env.DB, actorId);
  token = await createAdminSession(env.DB, actorId, "group-merge-admin");
  actor = { identityType: "user", id: actorId, email: "group-merge-admin@example.test", grants: administratorGrants };
});
async function fixture(mode = "roster") {
  const person = await insertOrgRepresentative(env.DB);
  const targetId = await insertOrganization(env.DB, "Group merge destination");
  const slug = `group-merge-${crypto.randomUUID()}`;
  await insertGroupSeat(slug, { publicRoster: mode === "roster" }, person);
  const groupId = (await env.DB.prepare("SELECT id FROM groups WHERE slug=?").bind(slug).first<string>("id"))!;
  await env.DB.prepare("UPDATE groups SET visibility='authenticated',public_leadership=? WHERE id=?")
    .bind(Number(mode === "leadership"), groupId)
    .run();
  if (mode === "leadership") await grantGroupLeadershipCapacity(env.DB, groupId, person.userId);
  await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(person.memberId).run();
  return { ...person, targetId, groupId, slug };
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_type,resource_id,reason_code FROM site_publication_requests ORDER BY sequence");
const projection = async () => {
  const value = await readSitePublicationSnapshot(env.DB, []);
  return { groups: value.groups, groupMembers: value.groupMembers };
};
async function merge(f: Awaited<ReturnType<typeof fixture>>, endSourceMembership = false) {
  return callApi(env, `/api/v1/organizations/${f.targetId}/merges`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sourceOrganizationId: f.organizationId, endSourceMembership }),
  });
}
describe("publication after group-only organization merges", () => {
  it.each(["ended", "blocked", "inactive_group", "listing_only", "closed_role"])(
    "leaves unchanged group projections quiet: %s",
    async (state) => {
      const f = await fixture(state === "closed_role" ? "leadership" : "roster");
      if (state === "ended" || state === "blocked") {
        const at = nowIso();
        await env.DB.prepare("UPDATE identities SET ended_at=?,blocked_at=? WHERE id=?")
          .bind(at, state === "blocked" ? at : null, f.identityId)
          .run();
      } else if (state === "inactive_group")
        await env.DB.prepare("UPDATE groups SET active=0 WHERE id=?").bind(f.groupId).run();
      else if (state === "listing_only")
        await env.DB.prepare("UPDATE groups SET public_roster=0,visibility='public' WHERE id=?").bind(f.groupId).run();
      else
        await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND context_id=?")
          .bind(nowIso(), f.userId, f.groupId)
          .run();
      const before = await projection();
      const response = await merge(f);
      expect(response.status, await response.clone().text()).toBe(201);
      expect(await projection()).toEqual(before);
      expect(await requests()).toEqual([]);
    },
  );
  it.each([false, true])(
    "publishes changed local history even when its expiry was already reported: %s",
    async (reported) => {
      const f = await fixture("leadership");
      await env.DB.prepare(
        "UPDATE user_roles SET created_at='2020-01-01T00:00:00.000Z',starts_at='2020-01-01T00:00:00.000Z',expires_at='2021-01-01T00:00:00.000Z' WHERE context_id=? AND user_id=?",
      )
        .bind(f.groupId, f.userId)
        .run();
      if (reported) expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(1);
      const recorded = await requests();
      const before = await projection();
      expect((await merge(f)).status).toBe(201);
      expect(await projection()).not.toEqual(before);
      const queued = await requests();
      expect(queued).toHaveLength(recorded.length + 1);
      expect(queued.slice(0, -1)).toEqual(recorded);
      expect(queued.at(-1)).toMatchObject({ resource_type: "organization_content", resource_id: f.targetId });
    },
  );
  it("keeps one intent when Member and group withdrawals overlap", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE members SET status='active' WHERE id=?").bind(f.memberId).run();
    await seedOrganizationAggregate(env.DB, f.targetId);
    const before = await projection();
    expect((await merge(f, true)).status).toBe(201);
    expect(await projection()).not.toEqual(before);
    expect(await requests()).toHaveLength(1);
  });
  it("captures a bulk identity withdrawal in one existing merge intent", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE members SET status='active' WHERE id=?").bind(f.memberId).run();
    for (let index = 0; index < 2; index++) {
      const person = await insertOrgRepresentative(env.DB, { organizationId: f.organizationId });
      await ensureGroupMembershipCapacity(env.DB, f.groupId, person.userId);
    }
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(f.memberId).run();
    expect((await projection()).groups[f.slug]?.roster?.current).toHaveLength(3);
    expect((await merge(f)).status).toBe(201);
    const after = (await projection()).groups[f.slug]!.roster!;
    expect(after.current).toHaveLength(0);
    expect(after.past).toHaveLength(3);
    expect(await requests()).toHaveLength(1);
  });
  it.each([false, true])(
    "publishes a private parent's public child only on its last seat closing: %s",
    async (alternative) => {
      const f = await fixture("private");
      const personal = await insertIndividualMembershipForUser(env.DB, f.userId);
      const childSlug = `${f.slug}-child`;
      await insertGroupSeat(childSlug, { publicRoster: true }, { userId: f.userId, ...personal });
      await env.DB.prepare("UPDATE groups SET parent_group_id=? WHERE slug=?").bind(f.groupId, childSlug).run();
      if (alternative) await ensureGroupMembershipCapacity(env.DB, f.groupId, f.userId);
      const before = await projection();
      expect((await merge(f)).status).toBe(201);
      if (alternative) expect(await projection()).toEqual(before);
      else expect(await projection()).not.toEqual(before);
      expect(await requests()).toHaveLength(alternative ? 0 : 1);
    },
  );
  it.each(["roster", "leadership"].flatMap((mode) => ["request", "audit"].map((failure) => ({ mode, failure }))))(
    "rolls back and retries group-only merge effects: %j",
    async ({ mode, failure }) => {
      const f = await fixture(mode);
      const state = async () =>
        Promise.all([
          queryAll(
            env.DB,
            "SELECT id,organization_id,ended_at,blocked_at,predecessor_identity_id FROM identities WHERE user_id=? ORDER BY id",
            [f.userId],
          ),
          queryAll(env.DB, "SELECT id,left_at FROM group_memberships WHERE user_id=? ORDER BY id", [f.userId]),
          queryAll(env.DB, "SELECT id,revoked_at FROM user_roles WHERE user_id=? ORDER BY id", [f.userId]),
          queryAll(env.DB, "SELECT id,merged_into_organization_id FROM organizations WHERE id IN (?,?) ORDER BY id", [
            f.organizationId,
            f.targetId,
          ]),
          queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id IN (?,?) ORDER BY id", [
            f.organizationId,
            f.targetId,
          ]),
          queryAll(env.DB, "SELECT desired_sequence,delivered_sequence FROM site_publication_delivery_state"),
        ]);
      const before = await state(),
        publicBefore = await projection();
      const sql =
        failure === "request"
          ? "CREATE TRIGGER fail_group_merge BEFORE INSERT ON site_publication_requests BEGIN SELECT RAISE(ABORT,'SYNTHETIC_GROUP_MERGE_FAILURE'); END"
          : "CREATE TRIGGER fail_group_merge BEFORE INSERT ON audit_log WHEN NEW.action='organization_merged' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_GROUP_MERGE_FAILURE'); END";
      await env.DB.prepare(sql).run();
      try {
        expect((await merge(f)).status).toBe(500);
        expect(await state()).toEqual(before);
        expect(await projection()).toEqual(publicBefore);
        expect(await requests()).toEqual([]);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_group_merge").run();
      }
      expect((await merge(f)).status).toBe(201);
      expect(await projection()).not.toEqual(publicBefore);
      expect(await requests()).toHaveLength(1);
    },
  );
  it.each(["authority", "source"])("retains group state when preflight changes: %s", async (race) => {
    const f = await fixture();
    const before = await projection();
    const raced = mutateBeforeNextBatch(env.DB, () =>
      race === "authority"
        ? env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), actor.id).run()
        : env.DB.prepare("UPDATE organizations SET updated_at='2035-01-01T00:00:00.000Z' WHERE id=?")
            .bind(f.organizationId)
            .run(),
    );
    await expect(
      mergeOrganizations(raced, actor, f.targetId, {
        sourceOrganizationId: f.organizationId,
        endSourceMembership: false,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await projection()).toEqual(before);
    expect(await requests()).toEqual([]);
    expect(await queryAll(env.DB, "SELECT ended_at FROM identities WHERE id=?", [f.identityId])).toEqual([
      { ended_at: null },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='organization_merged'")).toEqual([]);
  });

  it.each(["roster", "leadership", "private"])("publishes only changed public group projections: %s", async (mode) => {
    const f = await fixture(mode);
    expect(await queryAll(env.DB, "SELECT user_id FROM person_profile_slugs WHERE user_id=?", [f.userId])).toEqual([]);
    const before = await projection();
    const response = await merge(f);
    expect(response.status, await response.clone().text()).toBe(201);
    if (mode === "private") expect(await projection()).toEqual(before);
    else expect(await projection()).not.toEqual(before);
    expect(await requests()).toEqual(
      mode === "private"
        ? []
        : [
            expect.objectContaining({
              resource_type: "organization_content",
              resource_id: f.targetId,
              reason_code: "organization_content_changed",
            }),
          ],
    );
  });
});
