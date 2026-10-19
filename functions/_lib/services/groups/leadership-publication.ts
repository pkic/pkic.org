import type { DatabaseLike, StatementLike } from "../../types";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { unreportedGroupLeadershipExpiryPredicate } from "./leadership-expiry-publication";

/** Inside the mutation batch: after assignment/audit, before update or revocation. */
export function prepareGroupLeadershipPublication(
  db: DatabaseLike,
  input: {
    groupId: string;
    userRoleId: string;
    at: string;
    activeAfter: boolean;
    createdSeatId?: string;
    condition?: { sql: string; bindings: unknown[] };
  },
): StatementLike {
  return prepareSitePublicationRequest(
    db,
    {
      resourceType: "group_content",
      resourceId: input.groupId,
      revision: Date.parse(input.at),
      reasonCode: "group_content_changed",
      deduplicationKey: `group-leadership:${input.userRoleId}:${crypto.randomUUID()}`,
    },
    {
      sql: `EXISTS (SELECT 1 FROM user_roles ur JOIN groups g ON g.id=ur.context_id
      JOIN group_types gt ON gt.key=g.type_key
      WHERE ur.id=? AND ur.context_type='group' AND ur.context_id=?
        AND (${input.condition?.sql ?? "1"})
        AND ((g.active=1 AND g.public_leadership=1)
          OR ((?=1 OR (ur.revoked_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at>?))
              OR ${unreportedGroupLeadershipExpiryPredicate("ur")})
            AND ((g.active=1 AND g.public_roster=1 AND EXISTS (SELECT 1 FROM group_memberships seat
              WHERE seat.group_id=g.id AND seat.user_id=ur.user_id AND seat.identity_id=ur.identity_id
                AND seat.member_id=ur.member_id AND seat.left_at IS NULL))
              OR EXISTS (WITH RECURSIVE descendants(id) AS (
                SELECT g.id UNION ALL SELECT child.id FROM groups child JOIN descendants parent ON child.parent_group_id=parent.id
                  WHERE child.governance_inheritance_mode='inherited')
                SELECT 1 FROM descendants JOIN groups published ON published.id=descendants.id
                  WHERE published.id<>g.id AND published.active=1 AND published.public_leadership=1)))
          OR (g.active=1 AND (g.visibility='public' OR g.public_leadership=1 OR g.public_roster=1)
            AND EXISTS (SELECT 1 FROM group_memberships inserted JOIN members member ON member.id=inserted.member_id
              WHERE inserted.id=? AND inserted.group_id=g.id AND member.organization_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM group_memberships other WHERE other.group_id=g.id
                  AND other.member_id=inserted.member_id AND other.left_at IS NULL AND other.id<>inserted.id)))))`,
      bindings: [
        input.userRoleId,
        input.groupId,
        ...(input.condition?.bindings ?? []),
        Number(input.activeAfter),
        input.at,
        input.createdSeatId ?? null,
      ],
    },
  );
}
