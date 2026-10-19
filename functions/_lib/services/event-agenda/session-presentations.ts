import { prepareSitePublicationRequest } from "../site-publication-requests";
import { preparePublicationDocumentEffects } from "../site-publication-document-selections";
import { completePublicationDocumentEffectsForRequest } from "../site-publication-document-effects";
import { z } from "zod";
import {
  sessionPresentationVersionSchema,
  sessionPresentationVersionsQuerySchema,
  sessionPresentationReviewRequestSchema,
} from "../../../../assets/shared/schemas/session-presentation-versions";
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { preparePermissionsAuthorizationGuard, requirePermission } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { prepareScopedAuditLog } from "../audit";
import { prepareStorageDeletion } from "../storage-deletion-outbox";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
export interface SessionPresentationAuthority {
  eventId: string;
  occurrenceId: string;
  actor: AuthAdmin;
}
type Version = z.infer<typeof sessionPresentationVersionSchema>;
type StoredVersion = Version & { r2Key: string };
interface Row {
  id: string;
  occurrence_id: string;
  version_number: number;
  r2_key: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  source_key: string | null;
  source_digest: string;
  uploaded_by_user_id: string;
  uploaded_at: string;
  is_current: number;
  deleted_at: string | null;
  review_id: string | null;
  review_by: string | null;
  review_at: string | null;
  review_status: string | null;
  review_note: string | null;
}
const select = `SELECT version.id,version.occurrence_id,version.version_number,version.r2_key,version.file_name,version.file_size,version.mime_type,
  version.source_key,version.source_digest,version.uploaded_by_user_id,version.uploaded_at,version.is_current,version.deleted_at,
  review.id AS review_id,review.reviewed_by_user_id AS review_by,review.reviewed_at AS review_at,review.status AS review_status,review.note AS review_note
  FROM session_presentation_versions version LEFT JOIN session_presentation_reviews review ON review.id=(SELECT latest.id FROM session_presentation_reviews latest WHERE latest.version_id=version.id ORDER BY latest.reviewed_at DESC,latest.id DESC LIMIT 1)`;
function project(row: Row): StoredVersion {
  return {
    ...sessionPresentationVersionSchema.parse({
      id: row.id,
      occurrenceId: row.occurrence_id,
      versionNumber: row.version_number,
      fileName: row.file_name,
      fileSize: row.file_size,
      mimeType: row.mime_type,
      sourceKey: row.source_key,
      sourceDigest: row.source_digest,
      uploadedByUserId: row.uploaded_by_user_id,
      uploadedAt: row.uploaded_at,
      isCurrent: row.is_current === 1,
      deletedAt: row.deleted_at,
      latestReview: row.review_id
        ? {
            id: row.review_id,
            versionId: row.id,
            reviewedByUserId: row.review_by,
            reviewedAt: row.review_at,
            status: row.review_status,
            note: row.review_note,
          }
        : null,
    }),
    r2Key: row.r2_key,
  };
}
export function publicSessionPresentationVersion(version: StoredVersion): Version {
  const { r2Key: _key, ...visible } = version;
  return visible;
}
export async function requireSessionPresentation(
  db: DatabaseLike,
  authority: SessionPresentationAuthority,
  write = false,
) {
  requirePermission(authority.actor, write ? "agenda:write" : "agenda:read", { type: "event", id: authority.eventId });
  const session = await first<{ id: string }>(db, "SELECT id FROM event_agenda_occurrences WHERE id=? AND event_id=?", [
    authority.occurrenceId,
    authority.eventId,
  ]);
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "Session not found");
}
/** Guards belong to the atomic metadata command, after the external upload has completed. */
export function sessionPresentationWriteGuards(
  db: DatabaseLike,
  authority: SessionPresentationAuthority,
  extra = { sql: "1=1", bindings: [] as Array<string | number | null> },
) {
  const id = crypto.randomUUID();
  return {
    statements: [
      preparePermissionsAuthorizationGuard(db, authority.actor, [
        { permission: "agenda:write", context: { type: "event", id: authority.eventId } },
      ]),
      db
        .prepare(
          `INSERT INTO session_presentation_write_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM event_agenda_occurrences WHERE id=? AND event_id=?) AND (${extra.sql}) THEN 1 ELSE 0 END`,
        )
        .bind(id, authority.occurrenceId, authority.eventId, ...extra.bindings),
    ],
    cleanup: db.prepare("DELETE FROM session_presentation_write_guards WHERE id=?").bind(id),
  };
}
export function sessionPresentationFailure(error: unknown): never {
  if (error instanceof Error && error.message.includes("session_presentation_write_valid"))
    throw new AppError(
      409,
      "SESSION_PRESENTATION_CHANGED",
      "Session or presentation changed; refresh before trying again",
    );
  if (isAuthorizationGuardFailure(error))
    throw new AppError(403, "SESSION_PRESENTATION_AUTHORIZATION_CHANGED", "Presentation permission changed");
  throw error;
}
export async function getSessionPresentation(
  db: DatabaseLike,
  authority: SessionPresentationAuthority,
  versionId: string,
  write = false,
) {
  await requireSessionPresentation(db, authority, write);
  const row = await first<Row>(
    db,
    `${select} WHERE version.id=? AND version.event_id=? AND version.occurrence_id=? AND version.deleted_at IS NULL`,
    [versionId, authority.eventId, authority.occurrenceId],
  );
  if (!row) throw new AppError(404, "VERSION_NOT_FOUND", "Presentation version not found");
  return project(row);
}
export async function listSessionPresentations(
  db: DatabaseLike,
  authority: SessionPresentationAuthority,
  query: z.infer<typeof sessionPresentationVersionsQuerySchema>,
) {
  await requireSessionPresentation(db, authority);
  const search = query.q ? buildD1TextSearchFilter(query.q, ["version.file_name"]) : null;
  const { rows, total } = await queryPage<Row>(db, {
    sql: `${select} WHERE version.event_id=? AND version.occurrence_id=? AND version.deleted_at IS NULL ${search ? `AND ${search.sql}` : ""}`,
    bindings: [authority.eventId, authority.occurrenceId, ...(search?.bindings ?? [])],
    orderBy: resolveMappedOrderBy(
      query.sort,
      { versionNumber: "version.version_number", fileName: "version.file_name", uploadedAt: "version.uploaded_at" },
      "version.version_number DESC",
      "version.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return {
    versions: rows.map((row) => publicSessionPresentationVersion(project(row))),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  };
}
function unchangedVersion(version: StoredVersion) {
  return {
    sql: `EXISTS(SELECT 1 FROM session_presentation_versions WHERE id=? AND deleted_at IS NULL AND (SELECT review.id FROM session_presentation_reviews review WHERE review.version_id=? ORDER BY review.reviewed_at DESC,review.id DESC LIMIT 1) IS ?)`,
    bindings: [version.id, version.id, version.latestReview?.id ?? null],
  };
}
const unreferenced = `NOT EXISTS(SELECT 1 FROM event_agenda_session_history history JOIN event_agenda_occurrences occurrence ON occurrence.id=history.occurrence_id JOIN json_each(history.metadata_json,'$.materials') material
  WHERE occurrence.event_id=? AND json_extract(material.value,'$.presentationSource')='session' AND json_extract(material.value,'$.presentationVersionId')=? AND json_extract(material.value,'$.status') NOT IN('withdrawn','failed'))
  AND NOT EXISTS(SELECT 1 FROM event_agenda_publications publication JOIN json_each(publication.snapshot_json,'$.occurrences') occurrence JOIN json_each(occurrence.value,'$.history.materials') material
  WHERE publication.event_id=? AND json_extract(material.value,'$.presentationSource')='session' AND json_extract(material.value,'$.presentationVersionId')=?)`;
async function commit(
  db: DatabaseLike,
  authority: SessionPresentationAuthority,
  version: StoredVersion,
  statements: StatementLike[],
  action: string,
  details: unknown,
  protectReferences = false,
) {
  const original = unchangedVersion(version);
  const guard = sessionPresentationWriteGuards(
    db,
    authority,
    protectReferences
      ? {
          sql: `(${original.sql}) AND (${unreferenced})`,
          bindings: [...original.bindings, authority.eventId, version.id, authority.eventId, version.id],
        }
      : original,
  );
  try {
    await db.batch([
      ...guard.statements,
      ...statements,
      prepareScopedAuditLog(
        db,
        { type: "event", id: authority.eventId },
        "user",
        authority.actor.id,
        action,
        "session_presentation",
        version.id,
        details,
      ),
      guard.cleanup,
    ]);
  } catch (error) {
    sessionPresentationFailure(error);
  }
}
export async function reviewSessionPresentation(
  db: DatabaseLike,
  authority: SessionPresentationAuthority,
  versionId: string,
  input: z.infer<typeof sessionPresentationReviewRequestSchema>,
  publicationBucket?: R2Bucket,
) {
  await requireSessionPresentation(db, authority, true);
  const version = await getSessionPresentation(db, authority, versionId, true);
  const reviewId = crypto.randomUUID();
  const documentEffects =
    input.status !== "approved"
      ? await preparePublicationDocumentEffects(db, {
          eventId: authority.eventId,
          occurrenceId: authority.occurrenceId,
          versionId,
        })
      : null;
  const requestKey = `session-version-review:${reviewId}`;
  await commit(
    db,
    authority,
    version,
    [
      ...(documentEffects ? [documentEffects.guard] : []),
      db
        .prepare(
          "INSERT INTO session_presentation_reviews(id,version_id,reviewed_by_user_id,reviewed_at,status,note) VALUES(?,?,?,?,?,?)",
        )
        .bind(reviewId, versionId, authority.actor.id, nowIso(), input.status, input.note ?? null),
      prepareSitePublicationRequest(db, {
        resourceType: "session_material",
        resourceId: authority.occurrenceId,
        revision: version.versionNumber,
        reasonCode: "version_review_changed",
        deduplicationKey: requestKey,
        documentEffects: documentEffects?.effects ?? [],
      }),
    ],
    "session.presentation.reviewed",
    { status: input.status },
  );
  if (!(await completePublicationDocumentEffectsForRequest(db, publicationBucket, requestKey).catch(() => false)))
    throw new AppError(
      503,
      "PUBLICATION_DOCUMENT_WITHDRAWAL_PENDING",
      "The review is saved. Public download withdrawal is pending; check publication status before claiming completion.",
      { changeRecorded: true, publicationPending: true, publicationRequestKey: requestKey },
    );
  return { version: publicSessionPresentationVersion(await getSessionPresentation(db, authority, versionId, true)) };
}
export async function deleteSessionPresentation(
  db: DatabaseLike,
  authority: SessionPresentationAuthority,
  versionId: string,
  publicationBucket?: R2Bucket,
) {
  await requireSessionPresentation(db, authority, true);
  const version = await getSessionPresentation(db, authority, versionId, true);
  if (version.latestReview?.status === "approved")
    throw new AppError(
      409,
      "APPROVED_VERSION_NOT_DELETABLE",
      "Change the review disposition before deleting an approved version",
    );
  if (
    !(await first<{ valid: number }>(db, `SELECT 1 AS valid WHERE ${unreferenced}`, [
      authority.eventId,
      versionId,
      authority.eventId,
      versionId,
    ]))
  )
    throw new AppError(
      409,
      "REFERENCED_PRESENTATION_NOT_DELETABLE",
      "Detach the draft material or preserve its published version before deleting",
    );
  const documentEffects = await preparePublicationDocumentEffects(db, {
    eventId: authority.eventId,
    occurrenceId: authority.occurrenceId,
    versionId,
  });
  const requestKey = `session-version-delete:${versionId}`;
  const statements = [
    documentEffects.guard,
    prepareSitePublicationRequest(db, {
      resourceType: "session_material",
      resourceId: authority.occurrenceId,
      revision: version.versionNumber,
      reasonCode: "version_deleted",
      deduplicationKey: requestKey,
      documentEffects: documentEffects.effects,
    }),
    db
      .prepare("UPDATE session_presentation_versions SET deleted_at=?,is_current=0 WHERE id=? AND deleted_at IS NULL")
      .bind(nowIso(), versionId),
    db
      .prepare(
        "UPDATE session_presentation_versions SET is_current=1 WHERE id=(SELECT id FROM session_presentation_versions WHERE occurrence_id=? AND deleted_at IS NULL ORDER BY version_number DESC,id DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM session_presentation_versions WHERE occurrence_id=? AND is_current=1 AND deleted_at IS NULL)",
      )
      .bind(authority.occurrenceId, authority.occurrenceId),
  ];
  const deletion = prepareStorageDeletion(db, version.r2Key, nowIso(), "speaker_uploads");
  if (deletion) statements.push(deletion);
  await commit(
    db,
    authority,
    version,
    statements,
    "session.presentation.deleted",
    {
      versionNumber: version.versionNumber,
    },
    true,
  );
  if (!(await completePublicationDocumentEffectsForRequest(db, publicationBucket, requestKey).catch(() => false)))
    throw new AppError(
      503,
      "PUBLICATION_DOCUMENT_WITHDRAWAL_PENDING",
      "The version is deleted. Public download withdrawal is pending; check publication status before claiming completion.",
      { changeRecorded: true, publicationPending: true, publicationRequestKey: requestKey },
    );
  return { success: true };
}
