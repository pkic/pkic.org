import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { nowIso } from "../functions/_lib/utils/time";
import { enqueueGoogleGroupsSync } from "../functions/_lib/services/google-groups";
import { proposalIdentityFixture } from "./helpers/proposal-identity";
import { correct, registration, staff, remove, type Fixture } from "./helpers/identity-correction";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

async function group(parentId: string | null = null) {
  const id = crypto.randomUUID();
  const at = nowIso();
  await env.DB.prepare(`INSERT INTO groups(id,type_key,name,slug,parent_group_id,visibility,public_roster,eligibility_mode,created_at,updated_at)
    VALUES(?,'working_group','Mistaken association group',?,?,'public',1,'open',?,?)`)
    .bind(id, id, parentId, at, at)
    .run();
  return id;
}
async function seat(f: Fixture, groupId: string, identityId = f.identityId, ended = false) {
  const id = crypto.randomUUID();
  const at = nowIso();
  const memberId = await env.DB.prepare("SELECT member_id FROM identity_member_capacities WHERE identity_id=?")
    .bind(identityId)
    .first<string>("member_id");
  await env.DB.prepare(`INSERT INTO group_memberships(id,group_id,user_id,identity_id,member_id,source,joined_at,left_at,created_at,updated_at)
    VALUES(?,?,?,?,?,'self_service',?,?,?,?)`)
    .bind(id, groupId, f.userId, identityId, memberId, at, ended ? at : null, at, at)
    .run();
  return { id, groupId, memberId, at };
}
async function leadership(f: Fixture, groupId: string, identityId: string, memberId: string, roleId: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO user_roles(id,user_id,identity_id,member_id,role_id,context_type,context_id,single_holder_per_context,created_at)
    VALUES(?,?,?,?,?,'group',?,0,?)`)
    .bind(id, f.userId, identityId, memberId, roleId, groupId, nowIso())
    .run();
  return id;
}
async function list(f: Fixture, groupId: string) {
  const id = crypto.randomUUID();
  const email = `${id}@example.test`;
  const at = nowIso();
  await env.DB.prepare(`INSERT INTO mailing_lists(id,email,label,purpose,group_id,subscription_default,created_at,updated_at)
    VALUES(?,?,'Group erasure list','group',?,'group_members',?,?)`)
    .bind(id, email, groupId, at, at)
    .run();
  await enqueueGoogleGroupsSync(env.DB, { userId: f.userId, action: "add_to_list", googleGroupEmail: email });
  return email;
}
async function change(f: Fixture, action: "delete" | "correct") {
  const actor = await staff();
  return action === "correct" ? correct(f, actor.token) : remove(f, actor.token);
}
async function noMarkers() {
  expect(await env.DB.prepare("SELECT count(*) AS count FROM group_membership_erasures").first("count")).toBe(0);
}

it.each(["delete", "correct"] as const)(
  "%s erases mistaken seats, ends descendants, and queues final subscription changes",
  async (action) => {
    const f = await proposalIdentityFixture();
    const parent = await group();
    const child = await group(parent);
    const root = await seat(f, parent);
    const descendant = await seat(f, child, f.secondIdentityId);
    const lead = await leadership(f, parent, f.identityId, root.memberId!, "role-group_lead");
    const deputy = await leadership(f, child, f.secondIdentityId, descendant.memberId!, "role-group_deputy_lead");
    const emails = [await list(f, parent), await list(f, child)];
    const registrationId = action === "correct" ? await registration(f) : null;
    const response = await change(f, action);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM group_memberships WHERE id=?").bind(root.id).first()).toBeNull();
    const ended = await env.DB.prepare("SELECT identity_id,left_at FROM group_memberships WHERE id=?")
      .bind(descendant.id)
      .first();
    expect(ended).toEqual({ identity_id: f.secondIdentityId, left_at: expect.stringMatching(/Z$/) });
    expect(await env.DB.prepare("SELECT id FROM user_roles WHERE id=?").bind(lead).first()).toBeNull();
    expect(await env.DB.prepare("SELECT revoked_at FROM user_roles WHERE id=?").bind(deputy).first("revoked_at")).toBe(
      ended!.left_at,
    );
    for (const email of emails) {
      const rows = await env.DB.prepare(
        "SELECT action FROM google_groups_sync_queue WHERE user_id=? AND google_group_email=? AND action='remove_from_list'",
      )
        .bind(f.userId, email)
        .all();
      expect(rows.results).toEqual([{ action: "remove_from_list" }]);
    }
    const audit = await env.DB.prepare("SELECT details_json FROM audit_log WHERE entity_id=? AND action=?")
      .bind(
        f.identityId,
        action === "correct" ? "incorrect_representation_corrected" : "incorrect_representation_removed",
      )
      .first<string>("details_json");
    expect(JSON.parse(audit!)).toMatchObject({
      erasedGroupSeats: { from: [{ seatId: root.id, groupId: parent, joinedAt: root.at, leftAt: null }], to: null },
    });
    if (registrationId)
      expect(
        await env.DB.prepare("SELECT registration_identity_id FROM registrations WHERE id=?")
          .bind(registrationId)
          .first("registration_identity_id"),
      ).toBe(f.secondIdentityId);
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM site_publication_requests WHERE resource_id=?")
        .bind(f.identityId)
        .first("count"),
    ).toBeGreaterThan(0);
    await noMarkers();
  },
);

it.each(["delete", "correct"] as const)(
  "%s erases ended seats without ending another identity's participation",
  async (action) => {
    const f = await proposalIdentityFixture();
    const parent = await group();
    const old = await seat(f, parent, f.identityId, true);
    const current = await seat(f, parent, f.secondIdentityId);
    const email = await list(f, parent);
    const response = await change(f, action);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM group_memberships WHERE id=?").bind(old.id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT left_at FROM group_memberships WHERE id=?").bind(current.id).first()).toEqual({
      left_at: null,
    });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM google_groups_sync_queue WHERE google_group_email=? AND action='remove_from_list'",
      )
        .bind(email)
        .first("count"),
    ).toBe(0);
    const audit = await env.DB.prepare(
      "SELECT details_json FROM audit_log WHERE entity_id=? AND action IN ('incorrect_representation_removed','incorrect_representation_corrected')",
    )
      .bind(f.identityId)
      .first<string>("details_json");
    expect(JSON.parse(audit!)).toMatchObject({
      erasedGroupSeats: { from: [{ seatId: old.id, leftAt: old.at }], to: null },
    });
    await noMarkers();
  },
);

it("keeps descendant seats and subscriptions when another active parent seat remains", async () => {
  const f = await proposalIdentityFixture();
  const parent = await group();
  const child = await group(parent);
  await seat(f, parent);
  await seat(f, parent, f.secondIdentityId);
  const descendant = await seat(f, child, f.secondIdentityId);
  const deputy = await leadership(f, child, f.secondIdentityId, descendant.memberId!, "role-group_deputy_lead");
  const email = await list(f, child);
  expect((await change(f, "delete")).status).toBe(200);
  expect(await env.DB.prepare("SELECT left_at FROM group_memberships WHERE id=?").bind(descendant.id).first()).toEqual({
    left_at: null,
  });
  expect(await env.DB.prepare("SELECT revoked_at FROM user_roles WHERE id=?").bind(deputy).first()).toEqual({
    revoked_at: null,
  });
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM google_groups_sync_queue WHERE google_group_email=? AND action='remove_from_list'",
    )
      .bind(email)
      .first("count"),
  ).toBe(0);
  await noMarkers();
});

it.each(["delete", "correct"] as const)(
  "%s rolls back group erasure and every effect when a ballot protects the identity",
  async (action) => {
    const f = await proposalIdentityFixture();
    const parent = await group();
    const root = await seat(f, parent);
    const child = await group(parent);
    const descendant = await seat(f, child, f.secondIdentityId);
    await leadership(f, parent, f.identityId, root.memberId!, "role-group_lead");
    await leadership(f, child, f.secondIdentityId, descendant.memberId!, "role-group_deputy_lead");
    await list(f, parent);
    const voteId = crypto.randomUUID();
    const ballotId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO votes(id,slug,title,vote_type,owner_group_id,electorate_mode,created_by_user_id,threshold_type,opens_at,closes_at,created_at,updated_at)
    VALUES(?,?,'Protected vote','motion',?,'per_member',?,'simple_majority','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',?,?)`)
      .bind(voteId, voteId, parent, (await staff()).id, root.at, root.at)
      .run();
    await env.DB.prepare(`INSERT INTO vote_ballots(id,vote_id,user_id,identity_id,member_id,choice,submitted_at,updated_at)
    VALUES(?,?,?,?,?,'in_favor',?,?)`)
      .bind(ballotId, voteId, f.userId, f.identityId, root.memberId, root.at, root.at)
      .run();
    const registrationId = action === "correct" ? await registration(f) : null;
    const tables = [
      "group_memberships",
      "user_roles",
      "google_groups_sync_queue",
      "site_publication_requests",
      "audit_log",
    ];
    const before = await Promise.all(tables.map((table) => env.DB.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
    const response = await change(f, action);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "IDENTITY_HAS_PROTECTED_HISTORY" } });
    for (let i = 0; i < tables.length; i++)
      expect((await env.DB.prepare(`SELECT * FROM ${tables[i]} ORDER BY id`).all()).results).toEqual(before[i].results);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBe(
      f.identityId,
    );
    if (registrationId)
      expect(
        await env.DB.prepare("SELECT registration_identity_id FROM registrations WHERE id=?")
          .bind(registrationId)
          .first("registration_identity_id"),
      ).toBe(f.identityId);
    await noMarkers();
  },
);

it("continues to forbid ordinary seat deletion outside an incorrect representation removal", async () => {
  const f = await proposalIdentityFixture();
  const root = await seat(f, await group());
  await expect(env.DB.prepare("DELETE FROM group_memberships WHERE id=?").bind(root.id).run()).rejects.toThrow(
    "group memberships must be ended, not deleted",
  );
  expect(await env.DB.prepare("SELECT id FROM group_memberships WHERE id=?").bind(root.id).first("id")).toBe(root.id);
  await noMarkers();
});

it("reconciles subscriptions after automatic enrollment through the replacement identity", async () => {
  const f = await proposalIdentityFixture();
  const groupId = await group();
  await env.DB.batch([
    env.DB.prepare("UPDATE groups SET automatic_enrollment_mode='category' WHERE id=?").bind(groupId),
    env.DB.prepare(`INSERT INTO group_membership_category_rules(group_id,membership_category_code,permits_join,automatic_enrollment,created_at,updated_at)
      VALUES(?,'A',1,1,?,?)`).bind(groupId, nowIso(), nowIso()),
  ]);
  const old = await seat(f, groupId);
  const email = await list(f, groupId);
  const response = await change(f, "correct");
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await env.DB.prepare("SELECT id FROM group_memberships WHERE id=?").bind(old.id).first()).toBeNull();
  expect(
    (
      await env.DB.prepare(
        "SELECT identity_id FROM group_memberships WHERE group_id=? AND user_id=? AND left_at IS NULL",
      )
        .bind(groupId, f.userId)
        .all()
    ).results,
  ).toEqual([{ identity_id: f.secondIdentityId }]);
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM google_groups_sync_queue WHERE google_group_email=? AND action='remove_from_list'",
    )
      .bind(email)
      .first("count"),
  ).toBe(0);
  await noMarkers();
});

it("rolls back seat erasure when linked registration prevents the guarded identity deletion", async () => {
  const f = await proposalIdentityFixture();
  const root = await seat(f, await group());
  await registration(f);
  const response = await change(f, "delete");
  expect(response.status, await response.clone().text()).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "IDENTITY_HAS_PARTICIPATION" } });
  expect(await env.DB.prepare("SELECT left_at FROM group_memberships WHERE id=?").bind(root.id).first()).toEqual({
    left_at: null,
  });
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM audit_log WHERE entity_id=? AND action='incorrect_representation_removed'",
    )
      .bind(f.identityId)
      .first("count"),
  ).toBe(0);
  await noMarkers();
});
