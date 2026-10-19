import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSitePublicationPipeline } from "../functions/_lib/services/site-publication-runtime";
import { queueExpiredGroupLeadershipPublication } from "../functions/_lib/services/groups/leadership-expiry-publication";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { nowIso } from "../functions/_lib/utils/time";
import { queryAll } from "./helpers/context";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { grantAdministrator } from "./helpers/administrator";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertOrgRepresentative, insertUser } from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";
import { config } from "./helpers/site-publication-coordinator";

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO site_publication_delivery_state(id,updated_at) VALUES(1,?)").bind(nowIso()),
    env.DB.prepare("INSERT INTO site_publication_pipeline_fence(id,updated_at) VALUES(1,?)").bind(nowIso()),
  ]);
});
afterEach(() => vi.unstubAllGlobals());
async function fixture(state = "local") {
  const slug = `expiry-${crypto.randomUUID()}`;
  const person = await insertOrgRepresentative(env.DB, { email: `${slug}@example.test` });
  await env.DB.prepare("UPDATE identities SET show_on_organization_profile=0,hidden_from_public_profile=1 WHERE id=?")
    .bind(person.identityId)
    .run();
  await insertGroupSeat(slug, { publicRoster: ["roster", "overlap"].includes(state) }, person);
  const groupId = await env.DB.prepare("SELECT id FROM groups WHERE slug=?").bind(slug).first<string>("id");
  await env.DB.prepare("UPDATE groups SET visibility='authenticated',public_leadership=? WHERE id=?")
    .bind(["local", "overlap"].includes(state) ? 1 : 0, groupId)
    .run();
  let childSlug: string | null = null;
  if (["inherited", "local_only", "inactive_member", "overlap"].includes(state)) {
    childSlug = `${slug}-child`;
    await env.DB.prepare(`INSERT INTO groups(id,type_key,name,slug,parent_group_id,visibility,governance_inheritance_mode,public_leadership,active,created_at,updated_at)
      VALUES (?,'working_group','Expiry child',?,?,'authenticated',?,1,1,?,?)`)
      .bind(
        crypto.randomUUID(),
        childSlug,
        groupId,
        state === "local_only" ? "local_only" : "inherited",
        nowIso(),
        nowIso(),
      )
      .run();
  }
  const role = await grantGroupLeadershipCapacity(env.DB, groupId!, person.userId);
  await env.DB.prepare(
    "UPDATE user_roles SET title='Limited chair',starts_at='2020-01-01T00:00:00.000Z',created_at='2020-01-01T00:00:00.000Z',expires_at='2021-01-01T00:00:00.000Z' WHERE id=?",
  )
    .bind(role.roleAssignmentId)
    .run();
  if (state === "inactive_member")
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(person.memberId).run();
  return { ...person, groupId: groupId!, slug, childSlug, roleId: role.roleAssignmentId };
}
const requests = () =>
  queryAll(
    env.DB,
    "SELECT id,resource_type,resource_id,reason_code,deduplication_key FROM site_publication_requests ORDER BY sequence",
  );
const roleState = (id: string) =>
  queryAll(env.DB, "SELECT id,expires_at,revoked_at,starts_at,title,created_at FROM user_roles WHERE id=?", [id]);
const enabled = () => ({
  ...env,
  SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify({ ...config, debounceSeconds: 60 }),
  SITE_PUBLICATION_PROVIDER_TOKEN: "synthetic-provider-token",
});

describe("publication when leadership expires", () => {
  it("queues a clock-only group change without an approved agenda or provider write", async () => {
    const f = await fixture("overlap");
    await env.DB.prepare("UPDATE user_roles SET expires_at=? WHERE id=?")
      .bind(new Date(Date.now() + 2500).toISOString(), f.roleId)
      .run();
    const role = await roleState(f.roleId);
    const fetcher = vi.fn(async () => {
      throw new Error("Unexpected provider request");
    });
    vi.stubGlobal("fetch", fetcher);
    await runSitePublicationPipeline(enabled());
    const initial = await requests();
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({ resource_type: "site_content", reason_code: "repair" });
    const before = (await readSitePublicationSnapshot(env.DB, [])).groups;
    expect(before[f.slug]?.leadership).toHaveLength(1);
    expect(before[f.childSlug!]?.leadership).toHaveLength(1);
    expect(before[f.slug]?.roster?.current[0]?.title).toBe("Limited chair");
    await expect
      .poll(
        async () =>
          env.DB.prepare(
            "SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS expired FROM user_roles WHERE id=?",
          )
            .bind(f.roleId)
            .first<number>("expired"),
        { timeout: 3500, interval: 25 },
      )
      .toBe(1);
    const after = (await readSitePublicationSnapshot(env.DB, [])).groups;
    expect(after[f.slug]?.leadership).toHaveLength(0);
    expect(after[f.slug]?.pastLeadership).toHaveLength(1);
    expect(after[f.childSlug!]?.leadership).toHaveLength(0);
    expect(after[f.slug]?.roster?.current[0]?.title).toBe("Member");
    expect(after).not.toEqual(before);
    await runSitePublicationPipeline(enabled());
    const queued = await requests();
    expect(queued).toHaveLength(2);
    expect(queued[0]).toEqual(initial[0]);
    expect(queued[1]).toMatchObject({
      resource_type: "group_content",
      resource_id: f.groupId,
      reason_code: "group_content_changed",
    });
    expect(await roleState(f.roleId)).toEqual(role);
    await runSitePublicationPipeline(enabled());
    expect(await requests()).toEqual(queued);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ enabled: false }, { exclusiveActivationOwner: false }])(
    "leaves disabled ownership quiet: %j",
    async (patch) => {
      await fixture();
      expect(
        await runSitePublicationPipeline({
          ...env,
          SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify({ ...config, ...patch }),
        }),
      ).toEqual({ state: "disabled" });
      expect(await requests()).toEqual([]);
    },
  );
  it("requires configured credentials before creating expiry work", async () => {
    await fixture();
    await expect(
      runSitePublicationPipeline({ ...enabled(), SITE_PUBLICATION_PROVIDER_TOKEN: undefined }),
    ).rejects.toThrow("PUBLICATION_PROVIDER_CREDENTIAL_UNAVAILABLE");
    expect(await requests()).toEqual([]);
  });

  it.each([
    { state: "local", change: "none", count: 1 },
    { state: "roster", change: "none", count: 1 },
    { state: "inherited", change: "none", count: 1 },
    { state: "private", change: "none", count: 0 },
    { state: "local_only", change: "none", count: 0 },
    { state: "inactive_member", change: "none", count: 0 },
    { state: "local", change: "future", count: 0 },
    { state: "local", change: "revoked", count: 0 },
    { state: "local", change: "inactive_group", count: 0 },
  ])("queues only relevant expired terms: %j", async ({ state, change, count }) => {
    const f = await fixture(state);
    if (change === "future")
      await env.DB.prepare("UPDATE user_roles SET expires_at='2099-01-01T00:00:00.000Z' WHERE id=?")
        .bind(f.roleId)
        .run();
    if (change === "revoked")
      await env.DB.prepare("UPDATE user_roles SET revoked_at=expires_at WHERE id=?").bind(f.roleId).run();
    if (change === "inactive_group")
      await env.DB.prepare("UPDATE groups SET active=0 WHERE id=?").bind(f.groupId).run();
    const role = await roleState(f.roleId);
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(count);
    expect(await requests()).toHaveLength(count);
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(0);
    expect(await roleState(f.roleId)).toEqual(role);
  });

  it("handles legacy expiry timestamps and deduplicates each changed end separately", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE user_roles SET expires_at='2021-01-01 00:00:00' WHERE id=?").bind(f.roleId).run();
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(1);
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(0);
    await env.DB.prepare("UPDATE user_roles SET expires_at='2022-01-01T00:00:00.000Z' WHERE id=?").bind(f.roleId).run();
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(1);
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(0);
    expect(await requests()).toHaveLength(2);
  });

  it("coalesces concurrent expiry scans into one durable intent", async () => {
    await fixture();
    const queued = await Promise.all([
      queueExpiredGroupLeadershipPublication(env.DB),
      queueExpiredGroupLeadershipPublication(env.DB),
    ]);
    expect(queued.reduce((count, value) => count + value, 0)).toBe(1);
    expect(await requests()).toHaveLength(1);
  });

  it.each(["revoked", "extended", "private"])("rechecks a term that becomes %s before commit", async (change) => {
    const f = await fixture();
    const db = mutateBeforeNextBatch(env.DB, () =>
      change === "private"
        ? env.DB.prepare("UPDATE groups SET public_leadership=0 WHERE id=?").bind(f.groupId).run()
        : env.DB.prepare(
            change === "revoked"
              ? "UPDATE user_roles SET revoked_at=expires_at WHERE id=?"
              : "UPDATE user_roles SET expires_at='2099-01-01T00:00:00.000Z' WHERE id=?",
          )
            .bind(f.roleId)
            .run(),
    );
    expect(await queueExpiredGroupLeadershipPublication(db)).toBe(0);
    expect(await requests()).toEqual([]);
  });

  it("rolls back a partially inserted expiry batch and retries", async () => {
    await fixture();
    await fixture();
    const before = await queryAll(
      env.DB,
      "SELECT desired_sequence,delivered_sequence,updated_at FROM site_publication_delivery_state",
    );
    await env.DB.prepare(`CREATE TRIGGER fail_expiry_batch BEFORE INSERT ON site_publication_requests
      WHEN (SELECT COUNT(*) FROM site_publication_requests)>0
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_EXPIRY_REQUEST_FAILURE'); END`).run();
    try {
      await expect(queueExpiredGroupLeadershipPublication(env.DB)).rejects.toThrow("SYNTHETIC_EXPIRY_REQUEST_FAILURE");
      expect(await requests()).toEqual([]);
      expect(
        await queryAll(
          env.DB,
          "SELECT desired_sequence,delivered_sequence,updated_at FROM site_publication_delivery_state",
        ),
      ).toEqual(before);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_expiry_batch").run();
    }
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(2);
    expect(await requests()).toHaveLength(2);
  });

  it("drains a backlog in bounded batches without repeating earlier terms", async () => {
    const f = await fixture();
    const extra = JSON.stringify(
      Array.from({ length: 25 }, () => ({
        groupId: crypto.randomUUID(),
        seatId: crypto.randomUUID(),
        roleId: crypto.randomUUID(),
      })),
    );
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO groups(id,type_key,name,slug,visibility,public_leadership,active,created_at,updated_at)
        SELECT json_extract(value,'$.groupId'),'working_group','Expiry backlog','expiry-'||json_extract(value,'$.groupId'),'authenticated',1,1,?,? FROM json_each(?)`).bind(
        nowIso(),
        nowIso(),
        extra,
      ),
      env.DB.prepare(`INSERT INTO group_memberships(id,group_id,user_id,identity_id,member_id,source,joined_at,created_at,updated_at)
        SELECT json_extract(value,'$.seatId'),json_extract(value,'$.groupId'),?,?,?,'staff',?,?,? FROM json_each(?)`).bind(
        f.userId,
        f.identityId,
        f.memberId,
        nowIso(),
        nowIso(),
        nowIso(),
        extra,
      ),
      env.DB.prepare(`INSERT INTO user_roles(id,user_id,member_id,identity_id,role_id,context_type,context_id,single_holder_per_context,created_at,expires_at)
        SELECT json_extract(value,'$.roleId'),?,?,?,'role-group_lead','group',json_extract(value,'$.groupId'),0,'2020-01-01T00:00:00.000Z','2021-01-01T00:00:00.000Z' FROM json_each(?)`).bind(
        f.userId,
        f.memberId,
        f.identityId,
        extra,
      ),
    ]);
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(25);
    expect(await requests()).toHaveLength(25);
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(1);
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(0);
    expect(await requests()).toHaveLength(26);
  });

  it.each(
    ["title", "deactivate", "end_identity"].flatMap((operation) =>
      [false, true].map((reported) => ({ operation, reported })),
    ),
  )("preserves a clock withdrawal without duplicating a reported expiry: %j", async ({ operation, reported }) => {
    const f = await fixture("inherited");
    if (reported) expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(1);
    const recorded = await requests();
    const actorId = await insertUser(env.DB, "expiry-withdrawal-admin@example.test");
    await grantAdministrator(env.DB, actorId);
    const token = await createAdminSession(env.DB, actorId, "expiry-withdrawal-admin");
    const path =
      operation === "title"
        ? `/api/v1/groups/${f.groupId}/leadership/${f.roleId}`
        : operation === "deactivate"
          ? `/api/v1/users/${f.userId}`
          : `/api/v1/organizations/${f.organizationId}/identities/${f.identityId}`;
    const body =
      operation === "title"
        ? { title: "After expiry" }
        : operation === "deactivate"
          ? { active: false }
          : { transition: { state: "ended", reason: "Reviewed late withdrawal" } };
    const response = await callApi(env, path, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await requests()).toHaveLength(1);
    if (reported) expect(await requests()).toEqual(recorded);
    else
      expect((await requests())[0]).toMatchObject({
        resource_type:
          operation === "title" ? "group_content" : operation === "deactivate" ? "user_profile" : "identity_profile",
        resource_id: operation === "title" ? f.groupId : operation === "deactivate" ? f.userId : f.identityId,
      });
    expect(await queueExpiredGroupLeadershipPublication(env.DB)).toBe(0);
    expect(await requests()).toHaveLength(1);
  });
});
