import type { DatabaseLike, StatementLike } from "../../types";
import { PUBLIC_GROUP_MEMBER_SEAT_SOURCE_SQL } from "../membership/public-group-seat-sql";
import { ACTIVE_LEADERSHIP_PREDICATE_SQL, LEADERSHIP_ROLE_PREDICATE_SQL } from "./leadership-sql";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { unreportedGroupLeadershipExpiryPredicate } from "./leadership-expiry-publication";

function request(db: DatabaseLike, groupId: string, at: string, condition: { sql: string; bindings: unknown[] }) {
  return prepareSitePublicationRequest(
    db,
    {
      resourceType: "group_content",
      resourceId: groupId,
      revision: Date.parse(at),
      reasonCode: "group_content_changed",
      deduplicationKey: `group-seats:${groupId}:${crypto.randomUUID()}`,
    },
    condition,
  );
}

/** After INSERT/audit: actual inserted IDs distinguish new seats from duplicate or racing joins. */
export function prepareGroupSeatInsertionPublication(
  db: DatabaseLike,
  groupId: string,
  ids: readonly string[],
  at: string,
): StatementLike {
  const inserted = JSON.stringify(ids);
  return request(db, groupId, at, {
    sql: `EXISTS (SELECT 1 FROM group_memberships inserted
      JOIN groups scope ON scope.id=inserted.group_id AND scope.active=1
      JOIN members member ON member.id=inserted.member_id
      WHERE inserted.id IN (SELECT value FROM json_each(?)) AND inserted.group_id=?
        AND (scope.public_roster=1
          OR (member.organization_id IS NOT NULL AND member.status='active'
            AND (scope.visibility='public' OR scope.public_leadership=1)
            AND EXISTS (SELECT 1 ${PUBLIC_GROUP_MEMBER_SEAT_SOURCE_SQL} AND membership.id=inserted.id)
            AND NOT EXISTS (SELECT 1 ${PUBLIC_GROUP_MEMBER_SEAT_SOURCE_SQL}
              AND membership.group_id=inserted.group_id AND membership.member_id=inserted.member_id
              AND membership.id NOT IN (SELECT value FROM json_each(?))))))`,
    bindings: [inserted, groupId, inserted],
  });
}

/**
 * Before UPDATE/audit. Selection supplies id/group/user/member/left_at and boolean closes/membership_changed.
 * Only the last parent seat cascades; public history and inherited leadership need their preimage too.
 */
export function prepareGroupSeatChangePublication(
  db: DatabaseLike,
  groupId: string,
  at: string,
  selection: { sql: string; bindings: unknown[] },
): StatementLike {
  return request(db, groupId, at, groupSeatChangePublicationCondition(selection));
}

/**
 * Reconciliation may follow a capacity withdrawal whose stale public organization entry still needs removal.
 * Top-level definitions and materialization keep large capacity queries within D1's expression-depth limit.
 */
export function groupSeatChangePublicationCondition(
  selection: { sql: string; bindings: unknown[]; definitions?: string },
  includeWithdrawnMembers = false,
) {
  const previousMember = includeWithdrawnMembers
    ? "1"
    : `member.status='active'
    AND (a.left_at IS NOT NULL OR EXISTS (SELECT 1 ${PUBLIC_GROUP_MEMBER_SEAT_SOURCE_SQL} AND membership.id=a.id))`;
  return {
    sql: `EXISTS (WITH RECURSIVE ${selection.definitions ? `${selection.definitions},` : ""} selected AS MATERIALIZED (${selection.sql}),
      descendants(id,user_id) AS (
        SELECT child.id,root.user_id FROM selected root JOIN groups child ON child.parent_group_id=root.group_id
          WHERE root.closes=1 AND NOT EXISTS (SELECT 1 FROM group_memberships alternative
            WHERE alternative.group_id=root.group_id AND alternative.user_id=root.user_id AND alternative.left_at IS NULL
              AND alternative.id NOT IN (SELECT id FROM selected WHERE closes=1))
        UNION SELECT child.id,parent.user_id FROM descendants parent JOIN groups child ON child.parent_group_id=parent.id),
      affected AS (
        SELECT id,group_id,user_id,member_id,left_at,closes,membership_changed FROM selected
        UNION SELECT seat.id,seat.group_id,seat.user_id,seat.member_id,seat.left_at,1,1
          FROM descendants JOIN group_memberships seat ON seat.group_id=descendants.id AND seat.user_id=descendants.user_id
          WHERE seat.left_at IS NULL),
      closing_roles AS (
        SELECT ur.context_id FROM affected a JOIN user_roles ur ON ur.context_type='group' AND ur.context_id=a.group_id
          AND ur.user_id=a.user_id AND ur.member_id=a.member_id
          WHERE a.closes=1 AND ${LEADERSHIP_ROLE_PREDICATE_SQL}
            AND (${ACTIVE_LEADERSHIP_PREDICATE_SQL} OR ${unreportedGroupLeadershipExpiryPredicate("ur")})),
      leadership_groups(id) AS (
        SELECT context_id FROM closing_roles UNION SELECT child.id FROM leadership_groups parent
          JOIN groups child ON child.parent_group_id=parent.id WHERE child.governance_inheritance_mode='inherited')
      SELECT 1 WHERE EXISTS (SELECT 1 FROM affected a JOIN groups scope ON scope.id=a.group_id AND scope.active=1
        JOIN members member ON member.id=a.member_id
        WHERE scope.public_roster=1
          OR (a.membership_changed=1 AND member.organization_id IS NOT NULL AND (${previousMember})
            AND (scope.visibility='public' OR scope.public_leadership=1)
            AND (${includeWithdrawnMembers ? "member.status<>'active' OR " : ""} NOT EXISTS (SELECT 1 ${PUBLIC_GROUP_MEMBER_SEAT_SOURCE_SQL}
              AND membership.group_id=a.group_id AND membership.member_id=a.member_id
              AND membership.id NOT IN (SELECT id FROM affected WHERE membership_changed=1)))))
        OR EXISTS (SELECT 1 FROM affected a JOIN groups scope ON scope.id=a.group_id AND scope.active=1 AND scope.public_leadership=1
          JOIN user_roles ur ON ur.context_type='group' AND ur.context_id=a.group_id AND ur.user_id=a.user_id AND ur.member_id=a.member_id
          WHERE a.closes=1 AND ur.revoked_at IS NULL AND ${LEADERSHIP_ROLE_PREDICATE_SQL})
        OR EXISTS (SELECT 1 FROM leadership_groups JOIN groups scope ON scope.id=leadership_groups.id
          WHERE scope.active=1 AND scope.public_leadership=1))`,
    bindings: selection.bindings,
  };
}

/** Before a set-based insertion: selection excludes existing seats and is reused by the following INSERT. */
export function groupSeatAdditionPublicationCondition(selection: { sql: string; bindings: unknown[] }) {
  return {
    sql: `EXISTS (SELECT 1 FROM (${selection.sql}) addition
      JOIN groups scope ON scope.id=addition.group_id AND scope.active=1
      JOIN members member ON member.id=addition.member_id
      WHERE scope.public_roster=1 OR (member.organization_id IS NOT NULL AND member.status='active'
        AND (scope.visibility='public' OR scope.public_leadership=1)
        AND NOT EXISTS (SELECT 1 ${PUBLIC_GROUP_MEMBER_SEAT_SOURCE_SQL}
          AND membership.group_id=addition.group_id AND membership.member_id=addition.member_id)))`,
    bindings: selection.bindings,
  };
}
