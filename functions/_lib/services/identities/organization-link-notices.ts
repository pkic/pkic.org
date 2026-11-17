/**
 * Telling a person their verified address linked them to an organization.
 *
 * Every automatic link (on sign-in, on verifying an added address, or when a
 * domain claim reaches people who verified earlier) leaves one notice. The
 * person's organization question shows it until they answer: keeping the
 * link closes it, and "not my organization" ends the identity the link
 * created and records the existing "not my organization" answer so the
 * domain never links them there again.
 */
import { PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL } from "../people/profile-publication-sql";
import { PUBLIC_LEADERSHIP_SOURCE_SQL, PUBLIC_SEAT_SOURCE_SQL } from "../people/published-person";
import { AppError } from "../../errors";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { PUBLIC_MEMBER_USER_SOURCE_SQL } from "../membership/public-profile-sql";
import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuditLog, prepareAuditLogAfterOneChange, isAuditChangeGuardFailure } from "../audit";
import {
  identityProfileChanges,
  type IdentityProfileSnapshot,
  prepareIdentityProfilePublication,
  prepareIdentityProfileUpdateStatement,
} from "./profile-statement";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";

export interface OpenLinkNotice {
  identityId: string;
  organization: { id: string; name: string };
  domain: string;
}

export function prepareLinkNotice(
  db: DatabaseLike,
  input: { identityId: string; userId: string; organizationId: string; domain: string; at: string },
): StatementLike {
  return db
    .prepare(
      `INSERT INTO organization_link_notices (identity_id, user_id, organization_id, domain, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(input.identityId, input.userId, input.organizationId, input.domain, input.at);
}

/** The oldest unanswered notice whose identity is still active. */
export async function readOpenLinkNotice(db: DatabaseLike, userId: string): Promise<OpenLinkNotice | null> {
  const row = await first<{ identity_id: string; organization_id: string; name: string; domain: string }>(
    db,
    `SELECT notice.identity_id, notice.organization_id, organization.name, notice.domain
       FROM organization_link_notices notice
       JOIN identities identity ON identity.id = notice.identity_id
       JOIN organizations organization ON organization.id = notice.organization_id
      WHERE notice.user_id = ? AND notice.answered_at IS NULL
        AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
      ORDER BY notice.created_at, notice.identity_id LIMIT 1`,
    [userId],
  );
  return row
    ? { identityId: row.identity_id, organization: { id: row.organization_id, name: row.name }, domain: row.domain }
    : null;
}

/** "That's right": the notice is answered and the link stays. */
export function prepareLinkNoticeKept(
  db: DatabaseLike,
  input: { userId: string; organizationId: string; at: string },
): StatementLike {
  return db
    .prepare(
      `UPDATE organization_link_notices SET answered_at = ?
        WHERE user_id = ? AND organization_id = ? AND answered_at IS NULL`,
    )
    .bind(input.at, input.userId, input.organizationId);
}

/**
 * "Not my organization" on an automatic link: the identity it created ends,
 * the person's group seats follow, and the decline is audited. The caller
 * records the dismissal itself.
 */
export function prepareLinkNoticeDeclined(
  db: DatabaseLike,
  input: { userId: string; organizationId: string; at: string },
): StatementLike[] {
  const linked = `SELECT notice.identity_id FROM organization_link_notices notice
    WHERE notice.user_id = ? AND notice.organization_id = ? AND notice.answered_at IS NULL`;
  return [
    prepareSitePublicationRequest(
      db,
      {
        resourceType: "user_profile",
        resourceId: input.userId,
        revision: Date.parse(input.at),
        reasonCode: "user_profile_changed",
        deduplicationKey: `user-profile:${input.userId}:${crypto.randomUUID()}`,
      },
      {
        sql: `EXISTS(SELECT 1 ${PUBLIC_MEMBER_USER_SOURCE_SQL}
        AND person.id=? AND identity.id IN (${linked}) AND identity.organization_id IS NOT NULL)
        OR EXISTS(SELECT 1 ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL} AND person.id=?
          AND EXISTS(SELECT 1 FROM identities identity WHERE identity.user_id=person.id
            AND identity.id IN (${linked}) AND identity.ended_at IS NULL
            AND ((identity.started_at IS NOT NULL AND identity.blocked_at IS NULL AND identity.hidden_from_public_profile=0)
              OR EXISTS(SELECT 1 ${PUBLIC_SEAT_SOURCE_SQL} AND membership.identity_id=identity.id AND membership.left_at IS NULL)
              OR EXISTS(SELECT 1 ${PUBLIC_LEADERSHIP_SOURCE_SQL} AND ur.identity_id=identity.id AND ur.revoked_at IS NULL))))`,
        bindings: [input.userId, input.userId, input.organizationId, input.userId, input.userId, input.organizationId],
      },
    ),
    db
      .prepare(
        `INSERT INTO audit_log (id, actor_type, actor_id, actor_identity_id, action, entity_type, entity_id,
           details_json, created_at, scope_type, scope_id)
         SELECT lower(hex(randomblob(16))), 'user', ?, NULL, 'organization_link_declined', 'identity',
                identity.id, json_object('organizationId', json_object('from', NULL, 'to', identity.organization_id),
                  'endedAt', json_object('from', NULL, 'to', ?)), ?, NULL, NULL
           FROM identities identity
          WHERE identity.id IN (${linked}) AND identity.ended_at IS NULL`,
      )
      .bind(input.userId, input.at, input.at, input.userId, input.organizationId),
    db
      .prepare(`UPDATE identities SET ended_at = ?, updated_at = ? WHERE id IN (${linked}) AND ended_at IS NULL`)
      .bind(input.at, input.at, input.userId, input.organizationId),
    prepareLinkNoticeKept(db, input),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
  ];
}

/** Keeps the automatic link with the job title the person gives, and closes its notice. */
export async function keepLinkedOrganization(
  db: DatabaseLike,
  input: { userId: string; organizationId: string; jobTitle: string; at: string },
): Promise<void> {
  const identity = await first<
    IdentityProfileSnapshot & {
      id: string;
      updated_at: string;
      organization_id: string | null;
    }
  >(
    db,
    `SELECT id, updated_at, organization_id, job_title, email_id, biography, links_json, show_on_organization_profile FROM identities
      WHERE user_id = ? AND organization_id = ? AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL
      ORDER BY started_at, id LIMIT 1`,
    [input.userId, input.organizationId],
  );
  const details = { organizationId: input.organizationId, jobTitle: input.jobTitle };
  const changes = identity ? identityProfileChanges(identity, { jobTitle: input.jobTitle }) : {};
  const publication = identity
    ? prepareIdentityProfilePublication(db, identity, { jobTitle: input.jobTitle }, changes, input.at)
    : null;
  try {
    await db.batch([
      ...(identity
        ? [
            ...(publication ? [publication] : []),
            prepareIdentityProfileUpdateStatement(db, identity, { jobTitle: input.jobTitle }, input.at),
            prepareAuditLogAfterOneChange(
              db,
              "user",
              input.userId,
              "organization_link_kept",
              "user",
              input.userId,
              details,
              input.at,
            ),
          ]
        : [
            prepareAuditLog(
              db,
              "user",
              input.userId,
              "organization_link_kept",
              "user",
              input.userId,
              details,
              input.at,
            ),
          ]),
      prepareLinkNoticeKept(db, input),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error))
      throw new AppError(409, "IDENTITY_CHANGED", "The organization identity changed before the title was saved");
    throw error;
  }
}
