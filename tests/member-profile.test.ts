/**
 * The member-profile read models.
 *
 * The assertions worth having here are the ones about getting it quietly
 * wrong: availability leaking when it is private, a vouch counted twice, a
 * corrected points award still counting, or one member's vouch appearing on
 * another member's skill.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import { standingFor } from "../assets/shared/member-standing";
import {
  memberAvailabilitySchema,
  memberSkillsResponseSchema,
  memberStandingSchema,
} from "../assets/shared/schemas/member-profile";
import { getMemberAvailability, getMemberSkills, getMemberStanding } from "../functions/_lib/services/member-profile";
import { resetDb } from "./helpers/reset-db";
import { insertUser } from "./helpers/membership";

const NOW = () => new Date().toISOString();

async function insertSkill(slug: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO skills (id, slug, name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`)
    .bind(id, slug, name, NOW(), NOW())
    .run();
  return id;
}

async function claimSkill(userId: string, skillId: string, sortOrder = 0): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_skills (id, user_id, skill_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, skillId, sortOrder, NOW(), NOW())
    .run();
  return id;
}

async function vouch(userSkillId: string, voucherUserId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_skill_vouches (id, user_skill_id, voucher_user_id, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userSkillId, voucherUserId, NOW())
    .run();
}

async function award(userId: string, reasonKey: string, points: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_standing_awards (id, user_id, reason_key, points, awarded_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, reasonKey, points, NOW(), NOW())
    .run();
}

/** The ladder as seeded, so the policy tests read like the configured product. */
const LEVELS = [
  { level: 1, name: "Participant", fromPoints: 0 },
  { level: 2, name: "Contributor", fromPoints: 250 },
  { level: 3, name: "Contributor", fromPoints: 900 },
  { level: 4, name: "Contributor", fromPoints: 1800 },
  { level: 5, name: "Steward", fromPoints: 3000 },
];

describe("standing policy", () => {
  it("places a total in the highest band it reaches and reports the distance to the next", () => {
    const position = standingFor(2410, LEVELS);
    expect(position.level).toBe(4);
    expect(position.nextLevelAt).toBe(3000);
    expect(position.pointsToNextLevel).toBe(590);
  });

  it("has no next level at the top", () => {
    expect(standingFor(9999, LEVELS).pointsToNextLevel).toBeNull();
    expect(standingFor(9999, LEVELS).nextLevelAt).toBeNull();
  });

  it("resolves to an unranked position when every band is deactivated", () => {
    // A misconfigured ladder must not take a record page down with it.
    const position = standingFor(500, []);
    expect(position.level).toBe(0);
    expect(position.levelName).toBe("Unranked");
    expect(position.nextLevelAt).toBeNull();
  });

  it("resolves a band added out of order in the table", () => {
    const shuffled = [...LEVELS].reverse();
    expect(standingFor(2410, shuffled).level).toBe(4);
  });

  it("puts a reversed total back at the first band rather than at no band", () => {
    // Corrections are negative awards, so a total can go below zero.
    const position = standingFor(-50, LEVELS);
    expect(position.level).toBe(1);
    expect(position.points).toBe(-50);
  });
});

describe("member profile read models", () => {
  beforeEach(resetDb);

  it("orders skills by vouch count and reports who the viewer has vouched for", async () => {
    const owner = await insertUser(env.DB, "owner@example.test");
    const viewer = await insertUser(env.DB, "viewer@example.test");
    const other = await insertUser(env.DB, "other@example.test");

    const strong = await claimSkill(owner, await insertSkill("eidas", "eIDAS"), 1);
    const weak = await claimSkill(owner, await insertSkill("cbom", "CBOM"), 0);
    await vouch(strong, viewer);
    await vouch(strong, other);
    await vouch(weak, other);

    const result = memberSkillsResponseSchema.parse(await getMemberSkills(env.DB, owner, viewer));

    // Strongest first, regardless of the owner's own sort order.
    expect(result.skills.map((skill) => skill.name)).toEqual(["eIDAS", "CBOM"]);
    expect(result.skills[0]?.vouchCount).toBe(2);
    expect(result.skills[0]?.vouchedByViewer).toBe(true);
    // The viewer did not vouch for the second one.
    expect(result.skills[1]?.vouchedByViewer).toBe(false);
    expect(result.totalVouches).toBe(3);
  });

  it("marks nothing as vouched for a caller with no member identity", async () => {
    const owner = await insertUser(env.DB, "owner2@example.test");
    const other = await insertUser(env.DB, "other2@example.test");
    const claim = await claimSkill(owner, await insertSkill("pqc", "Post-quantum"));
    await vouch(claim, other);

    const result = memberSkillsResponseSchema.parse(await getMemberSkills(env.DB, owner, null));

    expect(result.skills[0]?.vouchCount).toBe(1);
    expect(result.skills[0]?.vouchedByViewer).toBe(false);
  });

  it("refuses a second vouch from the same member for the same skill", async () => {
    const owner = await insertUser(env.DB, "owner3@example.test");
    const voucher = await insertUser(env.DB, "voucher3@example.test");
    const claim = await claimSkill(owner, await insertSkill("ct", "Certificate transparency"));
    await vouch(claim, voucher);

    // One person, one vouch — the structural half of the anti-inflation rule.
    await expect(vouch(claim, voucher)).rejects.toThrow();

    const result = memberSkillsResponseSchema.parse(await getMemberSkills(env.DB, owner, voucher));
    expect(result.skills[0]?.vouchCount).toBe(1);
  });

  it("returns no availability when the member has set none", async () => {
    const userId = await insertUser(env.DB, "silent@example.test");
    expect(await getMemberAvailability(env.DB, userId, true)).toBeNull();
  });

  it("withholds private availability, and does so indistinguishably from having none", async () => {
    const userId = await insertUser(env.DB, "private@example.test");
    await env.DB.prepare(
      `INSERT INTO user_availability (user_id, open_to_employment, visibility, created_at, updated_at)
       VALUES (?, 1, 'private', ?, ?)`,
    )
      .bind(userId, NOW(), NOW())
      .run();

    // Same null a member with no row returns: the caller cannot tell that
    // something is being withheld.
    expect(await getMemberAvailability(env.DB, userId, true)).toBeNull();
  });

  it("withholds members-only availability from a viewer who is not a member", async () => {
    const userId = await insertUser(env.DB, "members-only@example.test");
    await env.DB.prepare(
      `INSERT INTO user_availability (user_id, open_to_contract, visibility, created_at, updated_at)
       VALUES (?, 1, 'members', ?, ?)`,
    )
      .bind(userId, NOW(), NOW())
      .run();

    expect(await getMemberAvailability(env.DB, userId, false)).toBeNull();
    const visible = await getMemberAvailability(env.DB, userId, true);
    expect(memberAvailabilitySchema.parse(visible).openToContract).toBe(true);
  });

  it("sums the ledger including corrections and excludes withdrawn recognitions", async () => {
    const userId = await insertUser(env.DB, "standing@example.test");
    await award(userId, "document_authored", 60);
    await award(userId, "meeting_attended", 5);
    // A correction is another row, never an edit of the first.
    await award(userId, "correction", -15);

    await env.DB.prepare(
      `INSERT INTO user_recognitions (id, user_id, recognition_key, label, awarded_at, created_at, updated_at)
       VALUES (?, ?, 'chair', 'Chair', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), userId, NOW(), NOW(), NOW())
      .run();
    await env.DB.prepare(
      `INSERT INTO user_recognitions
         (id, user_id, recognition_key, label, awarded_at, withdrawn_at, created_at, updated_at)
       VALUES (?, ?, 'streak', '3-year streak', ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), userId, NOW(), NOW(), NOW(), NOW())
      .run();

    const standing = memberStandingSchema.parse(await getMemberStanding(env.DB, userId));

    expect(standing.points).toBe(50);
    // The withdrawn one is history, not standing.
    expect(standing.recognitions.map((entry) => entry.key)).toEqual(["chair"]);
  });

  it("reports zero standing for someone who has earned nothing, rather than failing", async () => {
    const userId = await insertUser(env.DB, "new-member@example.test");
    const standing = memberStandingSchema.parse(await getMemberStanding(env.DB, userId));
    expect(standing.points).toBe(0);
    expect(standing.level).toBe(1);
    expect(standing.recognitions).toEqual([]);
  });

  it("never counts one member's vouches toward another's skill", async () => {
    const first = await insertUser(env.DB, "first@example.test");
    const second = await insertUser(env.DB, "second@example.test");
    const voucher = await insertUser(env.DB, "shared-voucher@example.test");
    const skillId = await insertSkill("shared", "Shared skill");
    const firstClaim = await claimSkill(first, skillId);
    await claimSkill(second, skillId);
    await vouch(firstClaim, voucher);

    expect(memberSkillsResponseSchema.parse(await getMemberSkills(env.DB, first, null)).totalVouches).toBe(1);
    expect(memberSkillsResponseSchema.parse(await getMemberSkills(env.DB, second, null)).totalVouches).toBe(0);
  });
});
