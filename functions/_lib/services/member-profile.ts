/**
 * The member-profile read models: vouched skills, availability, and standing.
 *
 * Each is its own resource with its own governance, so each has its own
 * function here rather than one query returning everything — a caller that
 * only needs standing should not pay for a skills join, and availability has a
 * visibility rule the other two do not.
 *
 * Counting happens in SQL. Nothing here fetches rows to count them in
 * TypeScript.
 */
import { standingFor, type StandingLevel } from "../../../assets/shared/member-standing";
import type { MemberAvailability, MemberSkill, MemberStanding } from "../../../assets/shared/schemas/member-profile";
import { batchFirst, batchRows } from "../db/pagination";
import type { DatabaseLike } from "../types";

interface SkillRow {
  skill_id: string;
  slug: string;
  name: string;
  vouch_count: number;
  vouched_by_viewer: number;
}

interface AvailabilityRow {
  open_to_employment: number;
  open_to_contract: number;
  roles_sought: string | null;
  services_offered: string | null;
  note: string | null;
  available_from: string | null;
  visibility: string;
  updated_at: string;
}

interface StandingRow {
  points: number | null;
}

interface LevelRow {
  level: number;
  name: string;
  from_points: number;
}

interface RecognitionRow {
  recognition_key: string;
  label: string;
  awarded_at: string;
}

export interface MemberSkillsReadModel {
  skills: MemberSkill[];
  totalVouches: number;
}

/**
 * A person's claimed skills, strongest first.
 *
 * `viewerUserId` decides only whether each skill is marked as already vouched
 * by the reader; it never changes which skills are returned. Pass null for a
 * caller with no member identity of its own.
 */
export async function getMemberSkills(
  db: DatabaseLike,
  userId: string,
  viewerUserId: string | null,
): Promise<MemberSkillsReadModel> {
  const rows = batchRows<SkillRow>(
    (
      await db.batch([
        db
          .prepare(
            `SELECT skill.id AS skill_id, skill.slug, skill.name,
                    (SELECT COUNT(*) FROM user_skill_vouches vouch
                      WHERE vouch.user_skill_id = claim.id) AS vouch_count,
                    (SELECT COUNT(*) FROM user_skill_vouches mine
                      WHERE mine.user_skill_id = claim.id
                        AND mine.voucher_user_id = ?) AS vouched_by_viewer
               FROM user_skills claim
               JOIN skills skill ON skill.id = claim.skill_id
              WHERE claim.user_id = ?
                AND skill.active = 1
              ORDER BY vouch_count DESC, claim.sort_order, skill.name COLLATE NOCASE`,
          )
          .bind(viewerUserId ?? "", userId),
      ])
    )[0],
  );

  const skills: MemberSkill[] = rows.map((row) => ({
    skillId: row.skill_id,
    slug: row.slug,
    name: row.name,
    vouchCount: row.vouch_count,
    vouchedByViewer: row.vouched_by_viewer > 0,
  }));

  return {
    skills,
    totalVouches: skills.reduce((total, skill) => total + skill.vouchCount, 0),
  };
}

/**
 * What someone is open to, or null.
 *
 * Null covers both "has said nothing" and "not visible to you", and the caller
 * cannot tell which. That is the point: distinguishing them would leak that
 * there is something being withheld.
 */
export async function getMemberAvailability(
  db: DatabaseLike,
  userId: string,
  viewerIsMember: boolean,
): Promise<MemberAvailability | null> {
  const row = batchFirst<AvailabilityRow>(
    (
      await db.batch([
        db
          .prepare(
            `SELECT open_to_employment, open_to_contract, roles_sought, services_offered, note,
                    available_from, visibility, updated_at
               FROM user_availability
              WHERE user_id = ?`,
          )
          .bind(userId),
      ])
    )[0],
  );
  if (!row) return null;
  if (row.visibility !== "members") return null;
  if (!viewerIsMember) return null;

  return {
    openToEmployment: row.open_to_employment === 1,
    openToContract: row.open_to_contract === 1,
    rolesSought: row.roles_sought,
    servicesOffered: row.services_offered,
    note: row.note,
    availableFrom: row.available_from,
    visibility: "members",
    updatedAt: row.updated_at,
  };
}

/**
 * Standing: the summed ledger, the band it places in, and recognitions held.
 *
 * The sum is taken in SQL over every award including corrections, so a
 * reversed award is reflected rather than needing a stored total to be
 * recomputed. Withdrawn recognitions are excluded — they are kept as history,
 * not shown as standing.
 */
export async function getMemberStanding(db: DatabaseLike, userId: string): Promise<MemberStanding> {
  const [pointsResult, recognitionsResult, levelsResult] = await db.batch([
    db.prepare(`SELECT COALESCE(SUM(points), 0) AS points FROM user_standing_awards WHERE user_id = ?`).bind(userId),
    db
      .prepare(
        `SELECT recognition_key, label, awarded_at
           FROM user_recognitions
          WHERE user_id = ? AND withdrawn_at IS NULL
          ORDER BY awarded_at DESC, id`,
      )
      .bind(userId),
    /* The ladder is configuration: read it rather than compiling it in, so the
       consortium can move a threshold without a deployment. */
    db.prepare(`SELECT level, name, from_points FROM standing_levels WHERE active = 1 ORDER BY from_points`),
  ]);

  const levels: StandingLevel[] = batchRows<LevelRow>(levelsResult).map((row) => ({
    level: row.level,
    name: row.name,
    fromPoints: row.from_points,
  }));
  const position = standingFor(batchFirst<StandingRow>(pointsResult)?.points ?? 0, levels);

  return {
    ...position,
    recognitions: batchRows<RecognitionRow>(recognitionsResult).map((row) => ({
      key: row.recognition_key,
      label: row.label,
      awardedAt: row.awarded_at,
    })),
  };
}
