/**
 * How an appointment seats somebody the group had not seated yet.
 *
 * A leader participates: refusing to appoint anyone without an existing seat
 * is what made the All Members forum's leadership picker useless (issue #26),
 * because a group whose participation follows from affiliation has no seats at
 * all and every appointment was refused until a manager knew to add the person
 * on the Members tab first. The group's own eligibility rules still decide who
 * may be appointed; this only spares the manager the second step.
 */
import type { GroupLeadershipAssignInput } from "../../../../assets/shared/schemas/groups";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import {
  ACTIVE_USER_CAPACITIES_CTE,
  activeParentGroupMembershipPredicate,
  eligibleGroupCapacityPredicate,
} from "../membership/capacity-query";

export interface LeadershipSeat {
  identity_id: string;
  member_id: string;
}

/**
 * The Member capacity an unseated appointee would take the group through.
 *
 * A live term needs a capacity the group's own eligibility rules currently
 * admit — the same predicate self-service joining uses, with managed groups
 * allowed because the caller is already an authorized group manager. A closed
 * historical term only needs the capacity the person once held, so a chair
 * from before the portal existed can still be recorded.
 */
export async function resolveEligibleLeadershipCapacity(
  db: DatabaseLike,
  groupId: string,
  input: GroupLeadershipAssignInput,
  closedTerm: boolean,
): Promise<LeadershipSeat> {
  const found = closedTerm
    ? await first<LeadershipSeat>(
        db,
        `SELECT capacity.identity_id, capacity.member_id
           FROM identity_member_capacities capacity
           JOIN identities identity ON identity.id = capacity.identity_id AND identity.started_at IS NOT NULL
          WHERE capacity.user_id = ? AND capacity.identity_id = ?
          LIMIT 1`,
        [input.userId, input.identityId],
      )
    : await first<LeadershipSeat>(
        db,
        `${ACTIVE_USER_CAPACITIES_CTE}
         SELECT capacity.identity_id, capacity.member_id
           FROM active_user_capacities capacity
           JOIN groups g ON g.id = ? AND g.active = 1
           LEFT JOIN group_membership_category_rules rule
             ON rule.group_id = g.id
            AND rule.membership_category_code = capacity.membership_category
          WHERE capacity.identity_id = ?
            AND ${eligibleGroupCapacityPredicate("g", "rule", "1")}
            AND ${activeParentGroupMembershipPredicate("g", "capacity.user_id")}
          LIMIT 1`,
        [input.userId, groupId, input.identityId],
      );
  if (!found) {
    throw new AppError(
      400,
      "GROUP_LEADER_CAPACITY_INVALID",
      closedTerm
        ? "The selected person never held that Member capacity"
        : "The selected person may not participate in this group through that Member capacity",
    );
  }
  return found;
}

/**
 * The live seat the appointment writes for somebody the group had not seated
 * yet. Closed historical terms write none — see the caller.
 *
 * `INSERT OR IGNORE` rather than a plain insert: a concurrent join between the
 * lookup above and this batch is a race the roster already tolerates, and the
 * grant beside it is what the appointment is actually for.
 */
export function buildLeadershipSeatStatement(
  db: DatabaseLike,
  actor: AuthAdmin,
  options: {
    groupId: string;
    userId: string;
    seat: LeadershipSeat;
    joinedAt: string;
    at: string;
  },
): StatementLike {
  return db
    .prepare(
      `INSERT OR IGNORE INTO group_memberships
         (id, group_id, user_id, identity_id, member_id, source, created_by_user_id,
          title, joined_at, left_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'staff', ?, NULL, ?, NULL, ?, ?)`,
    )
    .bind(
      uuid(),
      options.groupId,
      options.userId,
      options.seat.identity_id,
      options.seat.member_id,
      adminDatabaseUserId(actor),
      options.joinedAt,
      options.at,
      options.at,
    );
}
