import type { GroupStatsQuery, GroupStatsResponse } from "../../../../assets/shared/schemas/group-statistics";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { nowIso } from "../../utils/time";
import { prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "./governance";
import { getGroup } from "./read-model";

const UNBOUNDED_FROM = "0000-01-01T00:00:00.000Z";

interface StatsQuery {
  sql: string;
  bindings: readonly unknown[];
}

export interface GroupStatsQuerySet {
  participation: StatsQuery;
  activity: StatsQuery;
  joined: StatsQuery;
  left: StatsQuery;
}

/**
 * Builds the complete D1 aggregate set. The SQL keeps population semantics
 * explicit: capacities are rows, while people are distinct users. The
 * timestamp predicates remain in SQL so callers never have to post-process
 * membership or audit rows in the browser.
 */
export function buildGroupStatsQuerySet(
  groupId: string,
  query: GroupStatsQuery,
  generatedAt: string,
): GroupStatsQuerySet {
  const from = query.from ?? UNBOUNDED_FROM;
  const to = query.to ?? generatedAt;
  const participationPredicate =
    query.scope === "current"
      ? "membership.left_at IS NULL"
      : "membership.joined_at < ? AND (membership.left_at IS NULL OR membership.left_at > ?)";
  const participationBindings = query.scope === "current" ? [groupId] : [groupId, to, from];

  return {
    participation: {
      sql: `SELECT COUNT(*) AS capacity_count,
                   COUNT(DISTINCT membership.user_id) AS people_count
              FROM group_memberships membership
             WHERE membership.group_id = ?
               AND ${participationPredicate}`,
      bindings: participationBindings,
    },
    activity: {
      sql: `SELECT COUNT(*) AS action_count,
                   COUNT(DISTINCT audit.actor_id) AS actor_count
              FROM audit_log audit
              JOIN users actor_user ON actor_user.id = audit.actor_id
             WHERE audit.scope_type = 'group'
               AND audit.scope_id = ?
               AND audit.created_at >= ?
               AND audit.created_at < ?
               AND audit.actor_type IN ('admin', 'member', 'user')`,
      bindings: [groupId, from, to],
    },
    joined: {
      sql: `SELECT COUNT(*) AS count
              FROM group_memberships membership
             WHERE membership.group_id = ?
               AND membership.joined_at >= ?
               AND membership.joined_at < ?`,
      bindings: [groupId, from, to],
    },
    left: {
      sql: `SELECT COUNT(*) AS count
              FROM group_memberships membership
             WHERE membership.group_id = ?
               AND membership.left_at IS NOT NULL
               AND membership.left_at >= ?
               AND membership.left_at < ?`,
      bindings: [groupId, from, to],
    },
  };
}

interface ParticipationRow {
  capacity_count: number;
  people_count: number;
}

interface ActivityRow {
  action_count: number;
  actor_count: number;
}

interface CountRow {
  count: number;
}

function count(value: number | null | undefined): number {
  return Number(value ?? 0);
}

export async function getGroupStatistics(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  query: GroupStatsQuery,
): Promise<GroupStatsResponse> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupManagement(db, actor, group.id);

  const generatedAt = nowIso();
  const queries = buildGroupStatsQuerySet(group.id, query, generatedAt);
  let results;
  try {
    results = await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [group.id]),
      db.prepare(queries.participation.sql).bind(...queries.participation.bindings),
      db.prepare(queries.activity.sql).bind(...queries.activity.bindings),
      db.prepare(queries.joined.sql).bind(...queries.joined.bindings),
      db.prepare(queries.left.sql).bind(...queries.left.bindings),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
    }
    throw error;
  }
  const [, participationResult, activityResult, joinedResult, leftResult] = results;
  const participation = participationResult.results?.[0] as ParticipationRow | undefined;
  const activity = activityResult.results?.[0] as ActivityRow | undefined;
  const joined = joinedResult.results?.[0] as CountRow | undefined;
  const left = leftResult.results?.[0] as CountRow | undefined;
  const from = query.from ?? UNBOUNDED_FROM;
  const to = query.to ?? generatedAt;

  return {
    group: { id: group.id, slug: group.slug, name: group.name, type: group.type },
    generatedAt,
    scope: query.scope,
    window: { from: query.from ? from : null, to },
    participation: {
      people: { count: count(participation?.people_count) },
      capacities: { count: count(participation?.capacity_count) },
    },
    activity: {
      people: { actorCount: count(activity?.actor_count), actionCount: count(activity?.action_count) },
      capacities: { joinedCount: count(joined?.count), leftCount: count(left?.count) },
    },
  };
}
