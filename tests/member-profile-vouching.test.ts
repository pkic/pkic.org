/**
 * The vouching rules that a table constraint cannot express.
 *
 * `UNIQUE(user_skill_id, voucher_user_id)` covers "one person, one vouch". The
 * other two — nobody vouches for themselves, and only someone who shares a
 * group may vouch — are what make a vouch count mean anything, and they exist
 * only on this write path. If they regress, the number on a profile becomes a
 * popularity score anyone can inflate.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import { getMemberSkills } from "../functions/_lib/services/member-profile";
import {
  setMemberAvailability,
  vouchForSkill,
  withdrawSkillVouch,
} from "../functions/_lib/services/member-profile-writes";
import { resetDb } from "./helpers/reset-db";
import { insertIndividualMember } from "./helpers/membership";

const NOW = () => new Date().toISOString();

async function insertGroup(slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO groups (id, type_key, name, slug, active, created_at, updated_at)
     VALUES (?, 'working_group', ?, ?, 1, ?, ?)`,
  )
    .bind(id, slug, slug, NOW(), NOW())
    .run();
  return id;
}

async function joinGroup(groupId: string, m: { userId: string; memberId: string; identityId: string }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO group_memberships
       (id, group_id, user_id, identity_id, member_id, source, joined_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'staff', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), groupId, m.userId, m.identityId, m.memberId, NOW(), NOW(), NOW())
    .run();
}

async function claim(userId: string, slug: string): Promise<string> {
  const skillId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO skills (id, slug, name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`)
    .bind(skillId, slug, slug, NOW(), NOW())
    .run();
  await env.DB.prepare(
    `INSERT INTO user_skills (id, user_id, skill_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, skillId, NOW(), NOW())
    .run();
  return skillId;
}

const countFor = async (userId: string, skillId: string): Promise<number> => {
  const result = await getMemberSkills(env.DB, userId, null);
  return result.skills.find((skill) => skill.slug === skillId)?.vouchCount ?? 0;
};

describe("skill vouching rules", () => {
  beforeEach(resetDb);

  it("refuses a vouch for your own skill", async () => {
    const owner = await insertIndividualMember(env.DB, "H6", "self@example.test");
    const group = await insertGroup("self-group");
    await joinGroup(group, owner);
    const skillId = await claim(owner.userId, "self-skill");

    await expect(vouchForSkill(env.DB, owner.userId, skillId, owner.userId)).rejects.toThrow(/own skill/i);
    expect(await countFor(owner.userId, "self-skill")).toBe(0);
  });

  it("refuses a vouch from someone who shares no group", async () => {
    const owner = await insertIndividualMember(env.DB, "H6", "owner-a@example.test");
    const stranger = await insertIndividualMember(env.DB, "H6", "stranger@example.test");
    await joinGroup(await insertGroup("theirs"), owner);
    await joinGroup(await insertGroup("elsewhere"), stranger);
    const skillId = await claim(owner.userId, "shared-none");

    await expect(vouchForSkill(env.DB, owner.userId, skillId, stranger.userId)).rejects.toThrow(/share a group/i);
    expect(await countFor(owner.userId, "shared-none")).toBe(0);
  });

  it("accepts a vouch from someone in the same group, once", async () => {
    const owner = await insertIndividualMember(env.DB, "H6", "owner-b@example.test");
    const peer = await insertIndividualMember(env.DB, "H6", "peer@example.test");
    const group = await insertGroup("together");
    await joinGroup(group, owner);
    await joinGroup(group, peer);
    const skillId = await claim(owner.userId, "shared-skill");

    await vouchForSkill(env.DB, owner.userId, skillId, peer.userId);
    // Vouching again is the caller repeating themselves, not a second vouch.
    await vouchForSkill(env.DB, owner.userId, skillId, peer.userId);

    expect(await countFor(owner.userId, "shared-skill")).toBe(1);
  });

  it("stops counting a vouch once the voucher has left the group", async () => {
    const owner = await insertIndividualMember(env.DB, "H6", "owner-c@example.test");
    const peer = await insertIndividualMember(env.DB, "H6", "leaver@example.test");
    const group = await insertGroup("was-together");
    await joinGroup(group, owner);
    await joinGroup(group, peer);
    const skillId = await claim(owner.userId, "lapsed");
    await vouchForSkill(env.DB, owner.userId, skillId, peer.userId);

    await env.DB.prepare("UPDATE group_memberships SET left_at = ? WHERE user_id = ?").bind(NOW(), peer.userId).run();

    // The vouch already given stands — it was a real judgement at the time —
    // but a new one is refused now the shared standing has gone.
    expect(await countFor(owner.userId, "lapsed")).toBe(1);
    const other = await claim(owner.userId, "second-skill");
    await expect(vouchForSkill(env.DB, owner.userId, other, peer.userId)).rejects.toThrow(/share a group/i);
  });

  it("refuses a vouch for a skill the person has not claimed", async () => {
    const owner = await insertIndividualMember(env.DB, "H6", "owner-d@example.test");
    const peer = await insertIndividualMember(env.DB, "H6", "peer-d@example.test");
    const group = await insertGroup("claimless");
    await joinGroup(group, owner);
    await joinGroup(group, peer);

    await expect(vouchForSkill(env.DB, owner.userId, crypto.randomUUID(), peer.userId)).rejects.toThrow(/not claimed/i);
  });

  it("withdraws a vouch, and withdrawing one never given is not an error", async () => {
    const owner = await insertIndividualMember(env.DB, "H6", "owner-e@example.test");
    const peer = await insertIndividualMember(env.DB, "H6", "peer-e@example.test");
    const group = await insertGroup("withdrawing");
    await joinGroup(group, owner);
    await joinGroup(group, peer);
    const skillId = await claim(owner.userId, "withdrawn");

    await vouchForSkill(env.DB, owner.userId, skillId, peer.userId);
    expect(await countFor(owner.userId, "withdrawn")).toBe(1);

    await withdrawSkillVouch(env.DB, owner.userId, skillId, peer.userId);
    expect(await countFor(owner.userId, "withdrawn")).toBe(0);
    // Idempotent: withdrawing again is a no-op, not a failure.
    await withdrawSkillVouch(env.DB, owner.userId, skillId, peer.userId);
    expect(await countFor(owner.userId, "withdrawn")).toBe(0);
  });
});

describe("availability writes", () => {
  beforeEach(resetDb);

  it("replaces what was stored rather than accumulating rows", async () => {
    const member = await insertIndividualMember(env.DB, "H6", "avail@example.test");

    await setMemberAvailability(env.DB, member.userId, {
      openToEmployment: true,
      openToContract: false,
      rolesSought: "Principal architect",
      servicesOffered: null,
      note: null,
      availableFrom: "2027-01-01",
      visibility: "members",
    });
    const second = await setMemberAvailability(env.DB, member.userId, {
      openToEmployment: false,
      openToContract: true,
      rolesSought: null,
      servicesOffered: "PKI design review",
      note: "Engagements from 2 days",
      availableFrom: null,
      visibility: "private",
    });

    expect(second.openToContract).toBe(true);
    expect(second.openToEmployment).toBe(false);
    // The second write replaces the first in every column, including the one
    // the two states answer separately: a member who stopped looking for a job
    // must not keep advertising the roles they were after.
    expect(second.rolesSought).toBeNull();
    expect(second.servicesOffered).toBe("PKI design review");
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_availability WHERE user_id = ?")
      .bind(member.userId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });
});
