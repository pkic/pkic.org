import { first, all } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { isAuditOneChangeGuardFailure, prepareAuditLog, prepareAuditLogAfterOneChange } from "./audit";
import type {
  PresentationVersion,
  PresentationVersionReview,
  PresentationVersionReviewRequest,
  PresentationVersionsListQuery,
} from "../../../assets/shared/schemas/presentation-versions";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { prepareStorageDeletion, prepareStorageDeletionCancellation } from "./storage-deletion-outbox";

export interface PresentationProposalContext {
  id: string;
  status: string;
  title: string;
  event_slug: string;
  presentation_deadline: string | null;
}

export type { PresentationVersion, PresentationVersionReview };

type PresentationVersionRow = {
  id: string;
  proposal_id: string;
  version_number: number;
  r2_key: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by_user_id: string | null;
  uploaded_at: string;
  is_current: number;
  deleted_at: string | null;
  review_id: string | null;
  review_status: string | null;
  review_note: string | null;
  review_by: string | null;
  review_at: string | null;
};

function rowToVersion(row: PresentationVersionRow): PresentationVersion {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    versionNumber: row.version_number,
    r2Key: row.r2_key,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedAt: row.uploaded_at,
    isCurrent: row.is_current === 1,
    deletedAt: row.deleted_at,
    latestReview: row.review_id
      ? {
          id: row.review_id,
          versionId: row.id,
          reviewedByUserId: row.review_by!,
          reviewedAt: row.review_at!,
          status: row.review_status as PresentationVersionReview["status"],
          note: row.review_note,
        }
      : null,
  };
}

const VERSION_SELECT = `
  SELECT
    pv.id,
    pv.proposal_id,
    pv.version_number,
    pv.r2_key,
    pv.file_name,
    pv.file_size,
    pv.mime_type,
    pv.uploaded_by_user_id,
    pv.uploaded_at,
    pv.is_current,
    pv.deleted_at,
    pvr.id          AS review_id,
    pvr.status      AS review_status,
    pvr.note        AS review_note,
    pvr.reviewed_by_user_id AS review_by,
    pvr.reviewed_at AS review_at
  FROM presentation_versions pv
  LEFT JOIN presentation_version_reviews pvr ON pvr.id = (
    SELECT id FROM presentation_version_reviews
    WHERE version_id = pv.id
    ORDER BY reviewed_at DESC LIMIT 1
  )`;

export async function getPresentationProposalContext(
  db: DatabaseLike,
  proposalId: string,
): Promise<PresentationProposalContext> {
  const proposal = await first<PresentationProposalContext>(
    db,
    `SELECT sp.id, sp.status, sp.title, sp.presentation_deadline, e.slug AS event_slug
     FROM session_proposals sp
     JOIN events e ON e.id = sp.event_id
     WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  return proposal;
}

export async function listProposalPresentationVersions(
  db: DatabaseLike,
  proposalId: string,
  query: PresentationVersionsListQuery,
) {
  await getPresentationProposalContext(db, proposalId);
  const search = query.q ? buildD1TextSearchFilter(query.q, ["pv.file_name", "pv.mime_type"]) : null;
  const filters = ["pv.proposal_id = ?", "pv.deleted_at IS NULL"];
  const bindings: unknown[] = [proposalId];
  if (search) {
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(
    query.sort,
    { versionNumber: "pv.version_number", fileName: "pv.file_name COLLATE NOCASE", uploadedAt: "pv.uploaded_at" },
    "pv.version_number DESC",
    "pv.id ASC",
  );
  const { rows, total } = await queryPage<PresentationVersionRow>(
    db,
    {
      sql: `${VERSION_SELECT} ${where} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...bindings, query.limit, query.offset],
    },
    { sql: `SELECT COUNT(*) AS total FROM presentation_versions pv ${where}`, bindings },
  );
  const versions = rows.map(rowToVersion);
  return { versions, page: buildPageInfo(query.limit, query.offset, total, versions.length) };
}

export async function listPresentationVersions(db: DatabaseLike, proposalId: string): Promise<PresentationVersion[]> {
  const rows = await all<PresentationVersionRow>(
    db,
    `${VERSION_SELECT}
     WHERE pv.proposal_id = ? AND pv.deleted_at IS NULL
     ORDER BY pv.version_number DESC`,
    [proposalId],
  );
  return rows.map(rowToVersion);
}

export async function getPresentationVersion(db: DatabaseLike, versionId: string): Promise<PresentationVersion> {
  const row = await first<PresentationVersionRow>(db, `${VERSION_SELECT} WHERE pv.id = ? AND pv.deleted_at IS NULL`, [
    versionId,
  ]);
  if (!row) throw new AppError(404, "VERSION_NOT_FOUND", "Presentation version not found");
  return rowToVersion(row);
}

export async function getCurrentPresentationVersion(
  db: DatabaseLike,
  proposalId: string,
): Promise<PresentationVersion | null> {
  const row = await first<PresentationVersionRow>(
    db,
    `${VERSION_SELECT} WHERE pv.proposal_id = ? AND pv.is_current = 1 AND pv.deleted_at IS NULL`,
    [proposalId],
  );
  return row ? rowToVersion(row) : null;
}

export function presentationDownloadResponse(
  object: { body: ReadableStream; size: number },
  version: { fileName: string | null; mimeType: string | null; versionNumber: number },
): Response {
  const fileName = version.fileName ?? `presentation-v${version.versionNumber}`;
  const safeFileName = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encodedFileName = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const headers = new Headers();
  headers.set("Content-Type", version.mimeType ?? "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodedFileName}`);
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

/**
 * Records a new version row for an already-uploaded R2 object. Upload callers
 * persist a delayed cleanup intent before writing R2. This transaction
 * commits the pointer and audit while cancelling that intent; if it fails,
 * immediate cleanup is attempted and the durable intent remains when R2 is
 * unavailable. `bucket` is optional for tests/backfills that own cleanup.
 */
export async function createPresentationVersion(
  db: DatabaseLike,
  proposalId: string,
  opts: {
    r2Key: string;
    fileName: string | null;
    fileSize: number | null;
    mimeType: string | null;
    uploadedByUserId: string;
  },
  bucket?: R2Bucket,
  audit?: { actorType: "admin" | "user"; actorId: string; action: string },
): Promise<PresentationVersion> {
  const now = nowIso();
  const id = uuid();

  try {
    const statements = [
      db.prepare("UPDATE session_proposals SET updated_at = ? WHERE id = ?").bind(now, proposalId),
      db
        .prepare("UPDATE presentation_versions SET is_current = 0 WHERE proposal_id = ? AND is_current = 1")
        .bind(proposalId),
      db
        .prepare(
          `INSERT INTO presentation_versions
         (id, proposal_id, version_number, r2_key, file_name, file_size, mime_type,
          uploaded_by_user_id, uploaded_at, is_current)
       VALUES (
         ?, ?,
         (SELECT COALESCE(MAX(version_number), 0) + 1 FROM presentation_versions WHERE proposal_id = ?),
         ?, ?, ?, ?, ?, ?, 1
       )`,
        )
        .bind(
          id,
          proposalId,
          proposalId,
          opts.r2Key,
          opts.fileName,
          opts.fileSize,
          opts.mimeType,
          opts.uploadedByUserId,
          now,
        ),
    ];
    if (audit) {
      statements.push(
        prepareAuditLog(db, audit.actorType, audit.actorId, audit.action, "session_proposal", proposalId, {
          r2Key: opts.r2Key,
          fileName: opts.fileName,
          fileSize: opts.fileSize,
          mimeType: opts.mimeType,
        }),
      );
    }
    if (bucket) {
      statements.push(prepareStorageDeletionCancellation(db, opts.r2Key, "speaker_uploads"));
    }
    await db.batch(statements);
  } catch (error) {
    if (bucket) {
      try {
        await bucket.delete(opts.r2Key);
        await prepareStorageDeletionCancellation(db, opts.r2Key, "speaker_uploads").run();
      } catch {
        // The pre-upload compensation intent remains available for retry.
      }
    }
    throw error;
  }

  return getPresentationVersion(db, id);
}

/** Commits the proposal timestamp, version transition, and upload audit as one D1 transaction. */
export async function recordPresentationUpload(
  db: DatabaseLike,
  bucket: R2Bucket,
  proposalId: string,
  r2Key: string,
  uploadedByUserId: string,
  meta: { fileName: string | null; fileSize: number | null; mimeType: string | null },
  audit: { actorType: "admin" | "user"; action: string },
): Promise<void> {
  await createPresentationVersion(db, proposalId, { r2Key, uploadedByUserId, ...meta }, bucket, {
    ...audit,
    actorId: uploadedByUserId,
  });
}

export async function reviewPresentationVersion(
  db: DatabaseLike,
  proposalId: string,
  versionId: string,
  actorId: string,
  review: PresentationVersionReviewRequest,
): Promise<PresentationVersion> {
  const version = await getPresentationVersion(db, versionId);
  if (version.proposalId !== proposalId) {
    throw new AppError(404, "VERSION_NOT_FOUND", "Presentation version not found");
  }
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO presentation_version_reviews (id, version_id, reviewed_by_user_id, reviewed_at, status, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(uuid(), versionId, actorId, now, review.status, review.note?.trim() || null),
    prepareAuditLog(db, "admin", actorId, "presentation_version_reviewed", "presentation_version", versionId, {
      proposalId,
      status: review.status,
    }),
  ]);
  return getPresentationVersion(db, versionId);
}

export async function deletePresentationVersion(
  db: DatabaseLike,
  proposalId: string,
  versionId: string,
  actorId: string,
): Promise<void> {
  const version = await getPresentationVersion(db, versionId);
  if (version.proposalId !== proposalId) {
    throw new AppError(404, "VERSION_NOT_FOUND", "Presentation version not found");
  }

  if (version.isCurrent) {
    const latestReview = version.latestReview;
    if (latestReview?.status === "approved") {
      throw new AppError(409, "CANNOT_DELETE_APPROVED", "Cannot delete the currently approved presentation version");
    }
  }

  const now = nowIso();
  try {
    const storageDeletion = prepareStorageDeletion(db, version.r2Key, now, "speaker_uploads");
    await db.batch([
      db
        .prepare(
          `UPDATE presentation_versions
           SET deleted_at = ?, is_current = 0
           WHERE id = ? AND proposal_id = ? AND deleted_at IS NULL
             AND COALESCE((
               SELECT status FROM presentation_version_reviews
               WHERE version_id = presentation_versions.id
               ORDER BY reviewed_at DESC LIMIT 1
             ), '') <> 'approved'`,
        )
        .bind(now, versionId, proposalId),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actorId,
        "presentation_version_deleted",
        "presentation_version",
        versionId,
        { proposalId, r2Key: version.r2Key },
        now,
      ),
      ...(storageDeletion ? [storageDeletion] : []),
      db
        .prepare(
          `UPDATE presentation_versions SET is_current = 1
           WHERE id = (
             SELECT id FROM presentation_versions
             WHERE proposal_id = ? AND deleted_at IS NULL
             ORDER BY version_number DESC LIMIT 1
           ) AND ? = 1`,
        )
        .bind(proposalId, version.isCurrent ? 1 : 0),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      const current = await getPresentationVersion(db, versionId);
      if (current.latestReview?.status === "approved") {
        throw new AppError(409, "CANNOT_DELETE_APPROVED", "Cannot delete the currently approved presentation version");
      }
      throw new AppError(409, "PRESENTATION_VERSION_CONFLICT", "Presentation version changed concurrently");
    }
    throw error;
  }
}

export async function purgeAllPresentationVersions(db: DatabaseLike, proposalId: string): Promise<string[]> {
  const versions = await all<{ id: string; r2_key: string }>(
    db,
    "SELECT id, r2_key FROM presentation_versions WHERE proposal_id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  const now = nowIso();
  const deletionStatements = versions.flatMap((version) => {
    const statement = prepareStorageDeletion(db, version.r2_key, now, "speaker_uploads");
    return statement ? [statement] : [];
  });
  await db.batch([
    db
      .prepare(
        "UPDATE presentation_versions SET deleted_at = ?, is_current = 0 WHERE proposal_id = ? AND deleted_at IS NULL",
      )
      .bind(now, proposalId),
    ...deletionStatements,
  ]);
  return versions.map((v) => v.r2_key);
}
