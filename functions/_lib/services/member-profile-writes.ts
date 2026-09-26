/**
 * The member-profile write paths: vouching for a skill, and setting what
 * someone is open to.
 *
 * The vouching rules live here because two of the three cannot be expressed as
 * a row constraint:
 *
 *   1. one person, one vouch  — `UNIQUE(user_skill_id, voucher_user_id)`
 *   2. nobody vouches for themselves — a row cannot see whose skill it is
 *   3. only someone who shares a group may vouch — a row cannot see a roster
 *
 * Rules 2 and 3 are what make a vouch mean anything: without them the count is
 * a popularity number anyone can inflate for themselves or for a stranger.
 */
import { AppError } from "../errors";
import { batchFirst } from "../db/pagination";
import type { MemberAvailability } from "../../../assets/shared/schemas/member-profile";
import type { DatabaseLike } from "../types";

interface ClaimRow {
  id: string;
  user_id: string;
}

interface SharedGroupRow {
  shared: number;
}

const nowIso = () => new Date().toISOString();

/**
 * Resolves the claimed skill and checks the caller may vouch for it.
 *
 * Throws rather than returning a flag: every caller of this must refuse, and a
 * boolean invites one of them to carry on regardless.
 */
async function requireVouchableClaim(
  db: DatabaseLike,
  userId: string,
  skillId: string,
  voucherUserId: string,
): Promise<ClaimRow> {
  if (userId === voucherUserId) {
    throw new AppError(403, "SELF_VOUCH", "You cannot vouch for your own skill.");
  }

  const [claimResult, sharedResult] = await db.batch([
    db.prepare(`SELECT id, user_id FROM user_skills WHERE user_id = ? AND skill_id = ?`).bind(userId, skillId),
    db
      .prepare(
        /* A shared group is the standing that makes a vouch worth something:
           the voucher has actually sat in a room with this person. Both seats
           must be current — a lapsed membership does not carry the judgement. */
        `SELECT COUNT(*) AS shared
           FROM group_memberships mine
           JOIN group_memberships theirs ON theirs.group_id = mine.group_id
          WHERE mine.user_id = ? AND mine.left_at IS NULL
            AND theirs.user_id = ? AND theirs.left_at IS NULL`,
      )
      .bind(voucherUserId, userId),
  ]);

  const claim = batchFirst<ClaimRow>(claimResult);
  if (!claim) throw new AppError(404, "NOT_FOUND", "That member has not claimed this skill.");

  if ((batchFirst<SharedGroupRow>(sharedResult)?.shared ?? 0) === 0) {
    throw new AppError(403, "NO_SHARED_GROUP", "Only members who share a group with this person can vouch.");
  }

  return claim;
}

/** Records a vouch. Vouching twice is the caller's mistake, not a new vouch. */
export async function vouchForSkill(
  db: DatabaseLike,
  userId: string,
  skillId: string,
  voucherUserId: string,
): Promise<void> {
  const claim = await requireVouchableClaim(db, userId, skillId, voucherUserId);
  await db
    .prepare(
      /* The UNIQUE constraint is the authority on "already vouched"; ignoring
         the conflict makes the call idempotent rather than racing a read. */
      `INSERT INTO user_skill_vouches (id, user_skill_id, voucher_user_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_skill_id, voucher_user_id) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), claim.id, voucherUserId, nowIso())
    .run();
}

/** Withdraws a vouch. Withdrawing one that was never given is not an error. */
export async function withdrawSkillVouch(
  db: DatabaseLike,
  userId: string,
  skillId: string,
  voucherUserId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM user_skill_vouches
        WHERE voucher_user_id = ?
          AND user_skill_id IN (SELECT id FROM user_skills WHERE user_id = ? AND skill_id = ?)`,
    )
    .bind(voucherUserId, userId, skillId)
    .run();
}

export interface AvailabilityInput {
  openToEmployment: boolean;
  openToContract: boolean;
  rolesSought: string | null;
  servicesOffered: string | null;
  note: string | null;
  availableFrom: string | null;
  visibility: "members" | "private";
}

/** Stores what someone is open to, replacing whatever was there. */
export async function setMemberAvailability(
  db: DatabaseLike,
  userId: string,
  input: AvailabilityInput,
): Promise<MemberAvailability> {
  const at = nowIso();
  await db
    .prepare(
      `INSERT INTO user_availability
         (user_id, open_to_employment, open_to_contract, roles_sought, services_offered, note,
          available_from, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         open_to_employment = excluded.open_to_employment,
         open_to_contract   = excluded.open_to_contract,
         roles_sought       = excluded.roles_sought,
         services_offered   = excluded.services_offered,
         note               = excluded.note,
         available_from     = excluded.available_from,
         visibility         = excluded.visibility,
         updated_at         = excluded.updated_at`,
    )
    .bind(
      userId,
      input.openToEmployment ? 1 : 0,
      input.openToContract ? 1 : 0,
      input.rolesSought,
      input.servicesOffered,
      input.note,
      input.availableFrom,
      input.visibility,
      at,
      at,
    )
    .run();

  return { ...input, updatedAt: at };
}
