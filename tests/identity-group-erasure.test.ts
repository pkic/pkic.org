import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { nowIso } from "../functions/_lib/utils/time";
import { enqueueGoogleGroupsSync } from "../functions/_lib/services/google-groups";
import { proposalIdentityFixture } from "./helpers/proposal-identity";
import {
  requestIdentityCorrection,
  createIdentityRegistration,
  createStaffSession,
  requestIdentityDeletion,
  type IdentityCorrectionFixture,
} from "./helpers/identity-correction";
import { getPublicGroupDirectory } from "../functions/_lib/services/groups/public-directory";
import { readPublishedPeople } from "../functions/_lib/services/people/published-person";
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
async function seat(f: IdentityCorrectionFixture, groupId: string, identityId = f.identityId, ended = false) {
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
async function leadership(
  f: IdentityCorrectionFixture,
  groupId: string,
  identityId: string,
  memberId: string,
  roleId: string,
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO user_roles(id,user_id,identity_id,member_id,role_id,context_type,context_id,single_holder_per_context,created_at)
    VALUES(?,?,?,?,?,'group',?,0,?)`)
    .bind(id, f.userId, identityId, memberId, roleId, groupId, nowIso())
    .run();
  return id;
}
async function list(f: IdentityCorrectionFixture, groupId: string) {
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
async function change(f: IdentityCorrectionFixture, action: "delete" | "correct") {
  const actor = await createStaffSession();
  return action === "correct" ? requestIdentityCorrection(f, actor.token) : requestIdentityDeletion(f, actor.token);
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
    const creator = await createStaffSession();
    await env.DB.prepare(
      "UPDATE group_memberships SET title='Treasurer',source='staff',created_by_user_id=? WHERE id=?",
    )
      .bind(creator.id, root.id)
      .run();
    const emails = [await list(f, parent), await list(f, child)];
    const registrationId = action === "correct" ? await createIdentityRegistration(f) : null;
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
      erasedGroupSeats: {
        from: [
          {
            seatId: root.id,
            groupId: parent,
            userId: f.userId,
            identityId: f.identityId,
            memberId: root.memberId,
            title: "Treasurer",
            source: "staff",
            createdByUserId: creator.id,
            joinedAt: root.at,
            leftAt: null,
            createdAt: root.at,
            updatedAt: root.at,
          },
        ],
        to: null,
      },
      endedGroupSeats: {
        from: [{ seatId: descendant.id, identityId: f.secondIdentityId, leftAt: null }],
        to: [{ seatId: descendant.id, identityId: f.secondIdentityId, leftAt: ended!.left_at }],
      },
      removedIdentityRoles: {
        from: expect.arrayContaining([
          {
            roleAssignmentId: lead,
            userId: f.userId,
            roleId: "role-group_lead",
            contextType: "group",
            contextId: parent,
            identityId: f.identityId,
            memberId: root.memberId,
            title: null,
            startsAt: null,
            grantedByUserId: null,
            expiresAt: null,
            revokedAt: null,
            singleHolderPerContext: 0,
            createdAt: expect.any(String),
          },
        ]),
        to: null,
      },
      revokedGroupRoles: {
        from: [{ roleAssignmentId: deputy, identityId: f.secondIdentityId, revokedAt: null }],
        to: [{ roleAssignmentId: deputy, identityId: f.secondIdentityId, revokedAt: ended!.left_at }],
      },
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
    expect(JSON.parse(audit!)).not.toHaveProperty("removedIdentityRoles");
    await noMarkers();
  },
);

it.each(["delete", "correct"] as const)("%s omits erasure deltas when no group history changes", async (action) => {
  const f = await proposalIdentityFixture();
  const response = await change(f, action);
  expect(response.status, await response.clone().text()).toBe(200);
  const audit = await env.DB.prepare(
    "SELECT details_json FROM audit_log WHERE entity_id=? AND action IN ('incorrect_representation_removed','incorrect_representation_corrected')",
  )
    .bind(f.identityId)
    .first<string>("details_json");
  expect(JSON.parse(audit!)).toEqual(
    action === "correct"
      ? {
          replacementIdentityId: { from: null, to: f.secondIdentityId },
          reason: { from: null, to: "The organization was associated incorrectly." },
        }
      : {},
  );
  await noMarkers();
});

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
  const audit = await env.DB.prepare(
    "SELECT details_json FROM audit_log WHERE entity_id=? AND action='incorrect_representation_removed'",
  )
    .bind(f.identityId)
    .first<string>("details_json");
  const details = JSON.parse(audit!);
  expect(details).not.toHaveProperty("endedGroupSeats");
  expect(details).not.toHaveProperty("revokedGroupRoles");
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
      .bind(voteId, voteId, parent, (await createStaffSession()).id, root.at, root.at)
      .run();
    await env.DB.prepare(`INSERT INTO vote_ballots(id,vote_id,user_id,identity_id,member_id,choice,submitted_at,updated_at)
    VALUES(?,?,?,?,?,'in_favor',?,?)`)
      .bind(ballotId, voteId, f.userId, f.identityId, root.memberId, root.at, root.at)
      .run();
    const registrationId = action === "correct" ? await createIdentityRegistration(f) : null;
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
    const refusal = apiErrorPayloadSchema.parse(await response.json());
    expect(refusal.error.code).toBe("IDENTITY_HAS_PROTECTED_HISTORY");
    expect(refusal.error.message).toMatch(action === "correct" ? /cannot be corrected/u : /cannot be deleted/u);
    if (action === "correct") expect(refusal.error.message).not.toMatch(/End the representation/u);
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
  await createIdentityRegistration(f);
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

it.each([false, true])(
  "removes former public roster data only when the roster is published (%s)",
  async (publicRoster) => {
    const f = await proposalIdentityFixture();
    const groupId = await group();
    await env.DB.prepare("UPDATE groups SET public_roster=? WHERE id=?").bind(Number(publicRoster), groupId).run();
    const former = await seat(f, groupId, f.identityId, true);
    await env.DB.prepare("UPDATE group_memberships SET title='Treasurer' WHERE id=?").bind(former.id).run();
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(former.at, f.identityId).run();
    const before = await getPublicGroupDirectory(env.DB, groupId);
    if (publicRoster) expect(before.roster!.past).toMatchObject([{ title: "Treasurer" }]);
    else expect(before.roster).toBeNull();
    const response = await change(f, "delete");
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await getPublicGroupDirectory(env.DB, groupId);
    if (publicRoster) expect(after.roster!.past).toEqual([]);
    const requests = await env.DB.prepare("SELECT count(*) AS count FROM site_publication_requests WHERE resource_id=?")
      .bind(f.identityId)
      .first("count");
    expect(Number(requests) > 0).toBe(publicRoster);
    await noMarkers();
  },
);

it.each([false, true])("republishes erased former leadership only for public leadership (%s)", async (isPublic) => {
  const f = await proposalIdentityFixture();
  const groupId = await group();
  await env.DB.prepare("UPDATE groups SET public_roster=0,public_leadership=? WHERE id=?")
    .bind(Number(isPublic), groupId)
    .run();
  const former = await seat(f, groupId);
  const roleId = await leadership(f, groupId, f.identityId, former.memberId!, "role-group_lead");
  await env.DB.prepare("UPDATE user_roles SET title='Former chair',revoked_at=? WHERE id=?")
    .bind(former.at, roleId)
    .run();
  await env.DB.prepare("UPDATE group_memberships SET left_at=? WHERE id=?").bind(former.at, former.id).run();
  await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(former.at, f.identityId).run();
  await env.DB.prepare("INSERT INTO person_profile_slugs(slug,user_id,created_at) VALUES(?,?,?)")
    .bind(crypto.randomUUID(), f.userId, former.at)
    .run();
  const before = (await readPublishedPeople(env.DB, [f.userId], "public"))[f.userId];
  expect(before.groups.some((term) => term.title === "Former chair")).toBe(isPublic);
  const response = await change(f, "delete");
  expect(response.status, await response.clone().text()).toBe(200);
  const after = (await readPublishedPeople(env.DB, [f.userId], "public"))[f.userId];
  expect(after.groups.some((term) => term.title === "Former chair")).toBe(false);
  const requests = await env.DB.prepare("SELECT count(*) AS count FROM site_publication_requests WHERE resource_id=?")
    .bind(f.identityId)
    .first<number>("count");
  expect(Number(requests) > 0).toBe(isPublic);
  await noMarkers();
});

it("audits actual trigger effects outside the predicted descendant tree", async () => {
  const f = await proposalIdentityFixture();
  const root = await seat(f, await group());
  const sibling = await seat(f, await group(), f.secondIdentityId);
  const untouched = await seat(f, await group(), f.secondIdentityId);
  const deputy = await leadership(f, sibling.groupId, f.secondIdentityId, sibling.memberId!, "role-group_deputy_lead");
  // Model an evolved trigger: auditing must follow its actual writes without a second cascade policy.
  await env.DB.prepare(`CREATE TRIGGER test_erasure_extra_seat AFTER UPDATE OF left_at ON group_memberships
    WHEN OLD.id='${root.id}' AND OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
    BEGIN
      UPDATE group_memberships SET left_at=NEW.left_at,updated_at=NEW.updated_at WHERE id='${sibling.id}';
    END`).run();
  try {
    const response = await change(f, "delete");
    expect(response.status, await response.clone().text()).toBe(200);
    const audit = await env.DB.prepare(
      "SELECT details_json FROM audit_log WHERE entity_id=? AND action='incorrect_representation_removed'",
    )
      .bind(f.identityId)
      .first<string>("details_json");
    expect(JSON.parse(audit!)).toMatchObject({
      endedGroupSeats: {
        from: [{ seatId: sibling.id, leftAt: null }],
        to: [{ seatId: sibling.id, leftAt: expect.any(String) }],
      },
      revokedGroupRoles: {
        from: [{ roleAssignmentId: deputy, revokedAt: null }],
        to: [{ roleAssignmentId: deputy, revokedAt: expect.any(String) }],
      },
    });
    expect(
      await env.DB.prepare("SELECT left_at FROM group_memberships WHERE id=?").bind(untouched.id).first("left_at"),
    ).toBeNull();
    await noMarkers();
  } finally {
    await env.DB.prepare("DROP TRIGGER test_erasure_extra_seat").run();
  }
});
