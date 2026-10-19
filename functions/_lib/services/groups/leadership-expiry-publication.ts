import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { GROUP_LEADERSHIP_ROLE_IDS_SQL, publicGroupLeadershipSourceSql } from "./public-leadership-sql";

const EXPIRY_BATCH_LIMIT = 25;
export function groupLeadershipExpiryKeySql(alias: "ur" | "expired"): string {
  return `'group-leadership-expiry:'||${alias}.id||':'||hex(${alias}.expires_at)`;
}

/** A late mutation must preserve this clock withdrawal before it changes the expiry/capacity preimage. */
export function unreportedGroupLeadershipExpiryPredicate(alias: "ur" | "expired"): string {
  return `(${alias}.revoked_at IS NULL AND ${alias}.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS(SELECT 1 FROM site_publication_requests request WHERE request.deduplication_key=${groupLeadershipExpiryKeySql(alias)}))`;
}

const expiryKeySql = groupLeadershipExpiryKeySql("expired");
const publicExpirySourceSql = `FROM user_roles expired JOIN groups scope ON scope.id=expired.context_id
  WHERE expired.context_type='group' AND expired.role_id IN (${GROUP_LEADERSHIP_ROLE_IDS_SQL})
    AND ${unreportedGroupLeadershipExpiryPredicate("expired")}
    AND ((scope.active=1 AND scope.public_leadership=1)
      OR (scope.active=1 AND scope.public_roster=1 AND EXISTS(SELECT 1 FROM group_memberships seat
        JOIN users seated ON seated.id=seat.user_id AND seated.active=1
        WHERE seat.group_id=expired.context_id AND seat.user_id=expired.user_id
          AND seat.member_id=expired.member_id AND seat.identity_id=expired.identity_id AND seat.left_at IS NULL))
      OR EXISTS(WITH RECURSIVE effective_lineage(id,depth) AS (SELECT expired.context_id,0),
        sources AS (SELECT source_group.id ${publicGroupLeadershipSourceSql("expired")} WHERE ur.id=expired.id),
        descendants(id) AS (SELECT id FROM sources UNION SELECT child.id FROM descendants parent
          JOIN groups child ON child.parent_group_id=parent.id WHERE child.governance_inheritance_mode='inherited')
        SELECT 1 FROM descendants JOIN groups published ON published.id=descendants.id
          WHERE published.id<>expired.context_id AND published.active=1 AND published.public_leadership=1))`;

interface ExpiredPublicLeadership {
  id: string;
  groupId: string;
  expiresAt: string;
  deduplicationKey: string;
}

/** Clock-only invalidation, with the existing pipeline as the sole delivery/retry owner. Role state is untouched. */
export async function queueExpiredGroupLeadershipPublication(db: DatabaseLike): Promise<number> {
  const at = nowIso();
  const candidates = await all<ExpiredPublicLeadership>(
    db,
    `SELECT expired.id,expired.context_id AS groupId,expired.expires_at AS expiresAt,${expiryKeySql} AS deduplicationKey
      ${publicExpirySourceSql} ORDER BY expired.expires_at,expired.id LIMIT ?`,
    [EXPIRY_BATCH_LIMIT],
  );
  if (!candidates.length) return 0;
  const results = await db.batch(
    candidates.map((candidate) =>
      prepareSitePublicationRequest(
        db,
        {
          resourceType: "group_content",
          resourceId: candidate.groupId,
          revision: Date.parse(at),
          reasonCode: "group_content_changed",
          deduplicationKey: candidate.deduplicationKey,
        },
        {
          sql: `EXISTS(SELECT 1 ${publicExpirySourceSql} AND expired.id=? AND expired.context_id=? AND expired.expires_at IS ?)`,
          bindings: [candidate.id, candidate.groupId, candidate.expiresAt],
        },
      ),
    ),
  );
  return results.reduce((count, row) => count + Number((row.meta?.changes ?? 0) > 0), 0);
}
