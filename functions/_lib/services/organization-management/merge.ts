/**
 * Merging a duplicate organization into the one that stays, as one atomic
 * command.
 *
 * An identity's organization never changes (IDENTITY_SCOPE_IMMUTABLE), so a
 * person's active relationship with the source ends and continues at the
 * target as a successor identity (predecessor_identity_id), with the same
 * address, title, profile and verified domain. A person who already
 * represents the target keeps that identity. Blocked relationships stay
 * blocked at the target; pending invitations to the source are cancelled.
 * Domain claims become the target's additional domains, sponsorships and
 * "not my organization" answers follow, and the source is marked as merged
 * so its record, history, public address and credits lead to the target.
 *
 * A membership cannot move (MEMBER_HOLDER_IMMUTABLE): a source that holds the
 * only membership is refused (merge the other way), and when both hold one
 * the source's ends only on explicit confirmation.
 */
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { auditActorIdentityId } from "../audit-actor";
import { prepareAuditLog } from "../audit";
import { PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL } from "../people/profile-publication-sql";
import { PUBLIC_LEADERSHIP_SOURCE_SQL, PUBLIC_SEAT_SOURCE_SQL } from "../people/published-person";
import { groupSeatChangePublicationCondition } from "../groups/seat-publication";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import type {
  OrganizationMergeCreate,
  OrganizationMergeResult,
} from "../../../../assets/shared/schemas/organization-merge";
import { authorizedOrganizationMutationDb } from "./authorization";

const LIVE_MEMBERSHIP = "('active', 'pending')";
const ACTIVE_SOURCE = "source.started_at IS NOT NULL AND source.ended_at IS NULL AND source.blocked_at IS NULL";
/** The person's active identity at the target; binds the target id. */
const KEPT_AT_TARGET = `SELECT kept.id FROM identities kept WHERE kept.user_id = source.user_id AND kept.organization_id = ?
    AND kept.started_at IS NOT NULL AND kept.ended_at IS NULL AND kept.blocked_at IS NULL`;

interface MergeParty {
  id: string;
  name: string;
  slug: string | null;
  updated_at: string;
  merged_into_organization_id: string | null;
  member_id: string | null;
  member_status: string | null;
}

async function loadParty(db: DatabaseLike, organizationId: string): Promise<MergeParty> {
  const party = await first<MergeParty>(
    db,
    `SELECT organization.id, organization.name, organization.slug, organization.updated_at,
            organization.merged_into_organization_id, member.id AS member_id, member.status AS member_status
       FROM organizations organization
       LEFT JOIN members member ON member.organization_id = organization.id
      WHERE organization.id = ?`,
    [organizationId],
  );
  if (!party) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  if (party.merged_into_organization_id)
    throw new AppError(409, "ORGANIZATION_MERGED", `${party.name} was already merged into another organization`);
  return party;
}

function holdsLiveMembership(party: MergeParty): boolean {
  return party.member_status === "active" || party.member_status === "pending";
}

/** Refuses what a merge cannot carry safely; returns whether the source's membership ends. */
async function assertMergeable(
  db: DatabaseLike,
  target: MergeParty,
  source: MergeParty,
  input: OrganizationMergeCreate,
): Promise<boolean> {
  if (target.id === source.id) throw new AppError(422, "ORGANIZATION_MERGE_SELF", "Choose another organization");
  if (holdsLiveMembership(source) && !holdsLiveMembership(target))
    throw new AppError(
      409,
      "ORGANIZATION_MERGE_SOURCE_IS_MEMBER",
      `${source.name} holds the membership; merge ${target.name} into ${source.name} instead`,
    );
  const endsMembership = holdsLiveMembership(source) && holdsLiveMembership(target);
  if (endsMembership && !input.endSourceMembership)
    throw new AppError(
      409,
      "ORGANIZATION_MERGE_CONFIRMATION_REQUIRED",
      `Both organizations hold a membership; confirm that ${source.name}'s membership ends`,
    );
  const [pendingReview, sponsors] = await Promise.all([
    first<{ id: string }>(
      db,
      "SELECT id FROM organization_content_reviews WHERE organization_id = ? AND status = 'pending'",
      [source.id],
    ),
    all<{ organization_id: string }>(db, "SELECT organization_id FROM sponsors WHERE organization_id IN (?, ?)", [
      source.id,
      target.id,
    ]),
  ]);
  if (pendingReview)
    throw new AppError(
      409,
      "ORGANIZATION_MERGE_PENDING_REVIEW",
      `${source.name} has a profile change awaiting review; decide it first`,
    );
  if (sponsors.length > 1)
    throw new AppError(409, "ORGANIZATION_MERGE_SPONSOR_CONFLICT", "Both organizations hold a sponsor record");
  return endsMembership;
}

async function countMoves(db: DatabaseLike, targetId: string, sourceId: string) {
  const [identities, domains, sponsorships] = await Promise.all([
    first<{ moved: number; ended: number; invitations: number }>(
      db,
      `SELECT
         COALESCE(SUM(${ACTIVE_SOURCE} AND NOT EXISTS (${KEPT_AT_TARGET})), 0) AS moved,
         COALESCE(SUM(${ACTIVE_SOURCE} AND EXISTS (${KEPT_AT_TARGET})), 0) AS ended,
         COALESCE(SUM(source.started_at IS NULL AND source.ended_at IS NULL), 0) AS invitations
         FROM identities source WHERE source.organization_id = ?`,
      [targetId, targetId, sourceId],
    ),
    all<{ domain: string }>(
      db,
      "SELECT domain FROM organization_domain_claims WHERE organization_id = ? ORDER BY domain",
      [sourceId],
    ),
    first<{ count: number }>(db, "SELECT COUNT(*) AS count FROM sponsorships WHERE organization_id = ?", [sourceId]),
  ]);
  return {
    identitiesMoved: Number(identities?.moved ?? 0),
    identitiesEnded: Number(identities?.ended ?? 0),
    invitationsCancelled: Number(identities?.invitations ?? 0),
    domainsMoved: domains.map((row) => row.domain),
    sponsorshipsMoved: Number(sponsorships?.count ?? 0),
  };
}

/** Identities: successors at the target, decided in the audit log first and created from it. */
function prepareIdentityMoves(
  db: DatabaseLike,
  input: { mergeId: string; targetId: string; sourceId: string; staff: UserBackedAuthAdmin; at: string },
): StatementLike[] {
  const actorIdentityId = auditActorIdentityId("admin", input.staff.id);
  const target = input.targetId;
  const audit = (
    action: string,
    entityIdSql: string,
    extra: { sql: string; bindings: unknown[] },
    where: { sql: string; bindings: unknown[] },
  ) =>
    db
      .prepare(
        `INSERT INTO audit_log (id, actor_type, actor_id, actor_identity_id, action, entity_type, entity_id,
           details_json, created_at, scope_type, scope_id)
         SELECT lower(hex(randomblob(16))), 'admin', ?, ?, '${action}', 'identity', ${entityIdSql},
                json_object('mergeId', json_object('from', NULL, 'to', ?),
                            'userId', json_object('from', NULL, 'to', source.user_id),
                            'organizationId', json_object('from', ?, 'to', ?),
                            'predecessorIdentityId', json_object('from', NULL, 'to', source.id),
                            'wasDefault', json_object('from', NULL, 'to', source.is_default)${extra.sql}),
                ?, NULL, NULL
           FROM identities source
          WHERE source.organization_id = ? AND ${where.sql}`,
      )
      .bind(
        input.staff.id,
        actorIdentityId,
        input.mergeId,
        input.sourceId,
        target,
        ...extra.bindings,
        input.at,
        input.sourceId,
        ...where.bindings,
      );
  const none = { sql: "", bindings: [] };
  const successorFromAudit = (action: string) =>
    `SELECT entry.entity_id FROM audit_log entry
      WHERE entry.action = '${action}' AND json_extract(entry.details_json, '$.mergeId.to') = ?`;
  return [
    // A successor for every active relationship the person does not already hold at the target.
    audit("identity_continued_after_organization_merge", "lower(hex(randomblob(16)))", none, {
      sql: `${ACTIVE_SOURCE} AND NOT EXISTS (${KEPT_AT_TARGET})`,
      bindings: [target],
    }),
    // The person already represents the target: their source identity ends and the kept one carries on.
    audit(
      "identity_ended_by_organization_merge",
      "source.id",
      { sql: `, 'keptIdentityId', json_object('from', NULL, 'to', (${KEPT_AT_TARGET}))`, bindings: [target] },
      { sql: `${ACTIVE_SOURCE} AND EXISTS (${KEPT_AT_TARGET})`, bindings: [target] },
    ),
    // A block at the source stays a block at the target.
    audit(
      "identity_block_carried_by_organization_merge",
      "lower(hex(randomblob(16)))",
      { sql: ", 'blockedByUserId', json_object('from', NULL, 'to', source.blocked_by_user_id)", bindings: [] },
      {
        sql: `source.blocked_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM identities other WHERE other.user_id = source.user_id
                          AND other.organization_id = ? AND (other.ended_at IS NULL OR other.blocked_at IS NOT NULL))`,
        bindings: [target],
      },
    ),
    db
      .prepare("UPDATE identities SET is_default = 0, updated_at = ? WHERE organization_id = ? AND is_default = 1")
      .bind(input.at, input.sourceId),
    db
      .prepare(
        `UPDATE identities SET ended_at = ?, updated_at = ?
          WHERE organization_id = ? AND ended_at IS NULL`,
      )
      .bind(input.at, input.at, input.sourceId),
    db
      .prepare(
        `INSERT INTO identities (id, user_id, organization_id, email_id, verified_email_domain, job_title, biography,
           links_json, source, show_on_organization_profile, hidden_from_public_profile, is_default, invited_at, started_at,
           predecessor_identity_id, created_at, updated_at)
         SELECT entry.entity_id, source.user_id, ?, source.email_id, source.verified_email_domain, source.job_title,
                source.biography, source.links_json, source.source, source.show_on_organization_profile,
                source.hidden_from_public_profile, json_extract(entry.details_json, '$.wasDefault.to'), ?, ?, source.id, ?, ?
           FROM audit_log entry
           JOIN identities source ON source.id = json_extract(entry.details_json, '$.predecessorIdentityId.to')
          WHERE entry.action = 'identity_continued_after_organization_merge'
            AND json_extract(entry.details_json, '$.mergeId.to') = ?`,
      )
      .bind(input.targetId, input.at, input.at, input.at, input.at, input.mergeId),
    db
      .prepare(
        `INSERT INTO identities (id, user_id, organization_id, source, show_on_organization_profile, hidden_from_public_profile, invited_at,
           ended_at, blocked_at, blocked_by_user_id, predecessor_identity_id, created_at, updated_at)
         SELECT entry.entity_id, source.user_id, ?, 'staff', 0, source.hidden_from_public_profile, ?, ?, ?, source.blocked_by_user_id, source.id, ?, ?
           FROM audit_log entry
           JOIN identities source ON source.id = json_extract(entry.details_json, '$.predecessorIdentityId.to')
          WHERE entry.action = 'identity_block_carried_by_organization_merge'
            AND json_extract(entry.details_json, '$.mergeId.to') = ?`,
      )
      .bind(input.targetId, input.at, input.at, input.at, input.at, input.at, input.mergeId),
    // A person whose default was the ended identity defaults to the one they keep.
    db
      .prepare(
        `UPDATE identities SET is_default = 1, updated_at = ?
          WHERE id IN (SELECT json_extract(entry.details_json, '$.keptIdentityId.to') FROM audit_log entry
                        WHERE entry.action = 'identity_ended_by_organization_merge'
                          AND json_extract(entry.details_json, '$.mergeId.to') = ?
                          AND json_extract(entry.details_json, '$.wasDefault.to') = 1)
            AND NOT EXISTS (SELECT 1 FROM identities other WHERE other.user_id = identities.user_id
                             AND other.is_default = 1)`,
      )
      .bind(input.at, input.mergeId),
    // Work addresses follow their identity.
    db
      .prepare(
        `UPDATE user_emails
            SET identity_id = COALESCE(
              (SELECT successor.id FROM identities successor
                WHERE successor.predecessor_identity_id = user_emails.identity_id AND successor.organization_id = ?
                  AND successor.id IN (${successorFromAudit("identity_continued_after_organization_merge")})),
              (SELECT json_extract(entry.details_json, '$.keptIdentityId.to') FROM audit_log entry
                WHERE entry.action = 'identity_ended_by_organization_merge' AND entry.entity_id = user_emails.identity_id
                  AND json_extract(entry.details_json, '$.mergeId.to') = ?))
          WHERE identity_id IN (SELECT json_extract(entry.details_json, '$.predecessorIdentityId.to') FROM audit_log entry
                                 WHERE entry.action IN ('identity_continued_after_organization_merge',
                                                        'identity_ended_by_organization_merge')
                                   AND json_extract(entry.details_json, '$.mergeId.to') = ?)`,
      )
      .bind(input.targetId, input.mergeId, input.mergeId, input.mergeId),
  ];
}

export async function mergeOrganizations(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  targetId: string,
  input: OrganizationMergeCreate,
): Promise<OrganizationMergeResult> {
  const [target, source] = await Promise.all([loadParty(db, targetId), loadParty(db, input.sourceOrganizationId)]);
  const sourceMembershipEnded = await assertMergeable(db, target, source, input);
  const moves = await countMoves(db, target.id, source.id);
  const at = nowIso();
  const mergeId = uuid();
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, ["organizations:write", "membership:write"]);
  const groupWithdrawal = groupSeatChangePublicationCondition({
    sql: `SELECT seat.id,seat.group_id,seat.user_id,seat.member_id,seat.left_at,1 AS closes,1 AS membership_changed
      FROM group_memberships seat JOIN identities held ON held.id=seat.identity_id
      WHERE held.organization_id=? AND held.ended_at IS NULL AND seat.left_at IS NULL`,
    bindings: [source.id],
  });
  const statements: StatementLike[] = [
    // Neither organization changed or was merged since the checks above.
    prepareAuthorizationGuard(authorizedDb, {
      sql: `SELECT 1 WHERE
              EXISTS (SELECT 1 FROM organizations WHERE id = ? AND updated_at = ? AND merged_into_organization_id IS NULL)
          AND EXISTS (SELECT 1 FROM organizations WHERE id = ? AND updated_at = ? AND merged_into_organization_id IS NULL)
          AND NOT EXISTS (SELECT 1 FROM organization_content_reviews WHERE organization_id = ? AND status = 'pending')
          AND (SELECT COUNT(*) FROM members WHERE organization_id = ? AND status IN ${LIVE_MEMBERSHIP}) = ?`,
      bindings: [
        target.id,
        target.updated_at,
        source.id,
        source.updated_at,
        source.id,
        source.id,
        holdsLiveMembership(source) ? 1 : 0,
      ],
    }),
    // Capture the public preimage before ending relationships or moving sponsor ownership.
    prepareSitePublicationRequest(
      authorizedDb,
      {
        resourceType: "organization_content",
        resourceId: target.id,
        revision: Date.parse(at),
        reasonCode: "organization_content_changed",
        deduplicationKey: `organization-merge:${mergeId}`,
      },
      {
        sql: `EXISTS (SELECT 1 FROM members WHERE organization_id=? AND status='active')
          OR EXISTS (SELECT 1 FROM organizations destination JOIN organizations origin
            ON (origin.id=? OR origin.merged_into_organization_id=?)
            WHERE destination.id=? AND NULLIF(destination.slug,'') IS NOT NULL
              AND NULLIF(origin.slug,'') IS NOT NULL AND origin.slug<>destination.slug)
          OR (EXISTS (SELECT 1 FROM members WHERE organization_id=? AND status='active')
            AND EXISTS (SELECT 1 FROM identities source WHERE source.organization_id=?
              AND source.show_on_organization_profile=1 AND ${ACTIVE_SOURCE}
              AND NOT EXISTS (${KEPT_AT_TARGET})))
          OR EXISTS (SELECT 1 FROM sponsorships WHERE organization_id=?
            AND sponsor_type='event' AND pipeline_stage='active')
          OR EXISTS (SELECT 1 ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL}
            AND EXISTS (SELECT 1 FROM identities identity
              JOIN organizations origin ON origin.id=identity.organization_id
              JOIN organizations current ON current.id=COALESCE(origin.merged_into_organization_id,origin.id)
              JOIN organizations destination ON destination.id=?
              WHERE identity.user_id=person.id AND (origin.id=? OR origin.merged_into_organization_id=?)
                AND identity.started_at IS NOT NULL AND identity.blocked_at IS NULL
                AND ((identity.hidden_from_public_profile=0
                  AND ((origin.id=? AND identity.ended_at IS NULL)
                    OR current.name<>destination.name OR current.logo_r2_key IS NOT NULL OR destination.logo_r2_key IS NOT NULL))
                  OR (origin.id=? AND identity.ended_at IS NULL
                    AND (EXISTS (SELECT 1 ${PUBLIC_SEAT_SOURCE_SQL}
                          AND membership.identity_id=identity.id AND membership.left_at IS NULL)
                      OR EXISTS (SELECT 1 ${PUBLIC_LEADERSHIP_SOURCE_SQL}
                          AND ur.identity_id=identity.id AND ur.revoked_at IS NULL))))))
          OR ${groupWithdrawal.sql}`,
        bindings: [
          source.id,
          source.id,
          source.id,
          target.id,
          target.id,
          source.id,
          target.id,
          source.id,
          target.id,
          source.id,
          source.id,
          source.id,
          source.id,
          ...groupWithdrawal.bindings,
        ],
      },
    ),
    ...prepareIdentityMoves(authorizedDb, { mergeId, targetId: target.id, sourceId: source.id, staff: actor, at }),
    authorizedDb
      .prepare("UPDATE organization_domain_claims SET organization_id = ?, updated_at = ? WHERE organization_id = ?")
      .bind(target.id, at, source.id),
    authorizedDb
      .prepare("UPDATE sponsorships SET organization_id = ?, updated_at = ? WHERE organization_id = ?")
      .bind(target.id, at, source.id),
    authorizedDb
      .prepare("UPDATE sponsors SET organization_id = ?, updated_at = ? WHERE organization_id = ?")
      .bind(target.id, at, source.id),
    authorizedDb
      .prepare(
        `INSERT INTO affiliation_offer_dismissals (id, user_id, organization_id, created_at)
         SELECT lower(hex(randomblob(16))), dismissal.user_id, ?, dismissal.created_at
           FROM affiliation_offer_dismissals dismissal
          WHERE dismissal.organization_id = ?
            AND NOT EXISTS (SELECT 1 FROM affiliation_offer_dismissals kept
                             WHERE kept.user_id = dismissal.user_id AND kept.organization_id = ?)`,
      )
      .bind(target.id, source.id, target.id),
    authorizedDb.prepare("DELETE FROM affiliation_offer_dismissals WHERE organization_id = ?").bind(source.id),
    ...(sourceMembershipEnded && source.member_id
      ? [
          authorizedDb
            .prepare("UPDATE members SET status = 'inactive', updated_at = ? WHERE id = ?")
            .bind(at, source.member_id),
        ]
      : []),
    // Earlier merges into the source now lead straight to the target.
    authorizedDb
      .prepare(
        "UPDATE organizations SET merged_into_organization_id = ?, updated_at = ? WHERE merged_into_organization_id = ?",
      )
      .bind(target.id, at, source.id),
    authorizedDb
      .prepare(
        `UPDATE organizations SET merged_into_organization_id = ?, merged_at = ?, updated_at = ?
          WHERE id = ? AND merged_into_organization_id IS NULL`,
      )
      .bind(target.id, at, at, source.id),
    authorizedDb.prepare("UPDATE organizations SET updated_at = ? WHERE id = ?").bind(at, target.id),
  ];
  const details = {
    mergeId,
    organizationId: { from: source.id, to: target.id },
    name: { from: source.name, to: target.name },
    slug: { from: source.slug, to: target.slug },
    ...moves,
    sourceMembershipEnded,
    sourceMemberId: sourceMembershipEnded ? source.member_id : null,
  };
  statements.push(
    prepareAuditLog(authorizedDb, "admin", actor.id, "organization_merged", "organization", target.id, details, at),
    prepareAuditLog(
      authorizedDb,
      "admin",
      actor.id,
      "organization_merged_into",
      "organization",
      source.id,
      details,
      at,
    ),
  );
  await authorizedDb.batch(statements);
  return {
    organizationId: target.id,
    sourceOrganizationId: source.id,
    ...moves,
    sourceMembershipEnded,
  };
}

/** Each merged organization's member page address, leading to the page of the organization it joined. */
export async function readMergedOrganizationPageRedirects(
  db: DatabaseLike,
): Promise<Array<{ fromSlug: string; toSlug: string }>> {
  const rows = await all<{ from_slug: string; to_slug: string }>(
    db,
    `SELECT merged.slug AS from_slug, current.slug AS to_slug
       FROM organizations merged
       JOIN organizations current ON current.id = merged.merged_into_organization_id
      WHERE merged.slug IS NOT NULL AND merged.slug <> '' AND current.slug IS NOT NULL AND current.slug <> ''
        AND merged.slug <> current.slug
      ORDER BY merged.slug`,
  );
  return rows.map((row) => ({ fromSlug: row.from_slug, toSlug: row.to_slug }));
}
