import { run, first, all } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { prepareAuditLog } from "./audit";
import { prepareAuditLogAfterOneChange } from "./audit";
import type {
  PresentationVersion,
  PresentationVersionReview,
  PresentationVersionReviewRequest,
  PresentationVersionsListQuery,
} from "../../../assets/shared/schemas/presentation-versions";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { batchFirst, batchRows } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";

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
    pv.*,
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
  query: PresentationVersionsListQuery & { limit: number; offset: number },
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
  const [versionsResult, countResult] = await db.batch([
    db.prepare(`${VERSION_SELECT} ${where} ${orderBy} LIMIT ? OFFSET ?`).bind(...bindings, query.limit, query.offset),
    db.prepare(`SELECT COUNT(*) AS total FROM presentation_versions pv ${where}`).bind(...bindings),
  ]);
  const versions = batchRows<PresentationVersionRow>(versionsResult).map(rowToVersion);
  const total = Number(batchFirst<{ total: number }>(countResult)?.total ?? 0);
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
 * Records a new version row for an already-uploaded R2 object. R2 and D1 are
 * not one transaction: `storePresentationFile` puts the object first, so a
 * D1 batch failure here (FK/UNIQUE violation, outage) would otherwise leave
 * that object orphaned — uploaded but never referenced by any committed row.
 * When `bucket` is supplied, a batch failure is compensated by deleting the
 * just-written object, the same principle §9.2 established for ICS file
 * uploads (`meeting-calendar/admin-ics-files.ts`'s `uploadIcsFile`). `bucket`
 * is optional because some call sites (tests, backfills) create a version
 * row for an object they manage themselves and have no orphan to clean up.
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
    await db.batch(statements);
  } catch (error) {
    if (bucket) await bucket.delete(opts.r2Key).catch(() => {});
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

function isPresentationDeleteGuardFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes("NOT NULL constraint failed: audit_log.action");
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
    if (isPresentationDeleteGuardFailure(error)) {
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
  await run(
    db,
    "UPDATE presentation_versions SET deleted_at = ?, is_current = 0 WHERE proposal_id = ? AND deleted_at IS NULL",
    [now, proposalId],
  );
  return versions.map((v) => v.r2_key);
}
