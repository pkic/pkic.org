import { run, first, all } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

export interface PresentationVersion {
  id: string;
  proposalId: string;
  versionNumber: number;
  r2Key: string;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  uploadedByUserId: string | null;
  uploadedAt: string;
  isCurrent: boolean;
  deletedAt: string | null;
  latestReview: PresentationVersionReview | null;
}

export interface PresentationVersionReview {
  id: string;
  versionId: string;
  reviewedByUserId: string;
  reviewedAt: string;
  status: "approved" | "rejected" | "needs_revision";
  note: string | null;
}

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
): Promise<PresentationVersion> {
  const now = nowIso();
  const id = uuid();

  const prev = await first<{ max_version: number | null }>(
    db,
    "SELECT MAX(version_number) AS max_version FROM presentation_versions WHERE proposal_id = ?",
    [proposalId],
  );
  const versionNumber = (prev?.max_version ?? 0) + 1;

  await run(db, "UPDATE presentation_versions SET is_current = 0 WHERE proposal_id = ? AND is_current = 1", [
    proposalId,
  ]);

  await run(
    db,
    `INSERT INTO presentation_versions
       (id, proposal_id, version_number, r2_key, file_name, file_size, mime_type,
        uploaded_by_user_id, uploaded_at, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id,
      proposalId,
      versionNumber,
      opts.r2Key,
      opts.fileName,
      opts.fileSize,
      opts.mimeType,
      opts.uploadedByUserId,
      now,
    ],
  );

  return getPresentationVersion(db, id);
}

export async function addVersionReview(
  db: DatabaseLike,
  versionId: string,
  opts: {
    reviewedByUserId: string;
    status: PresentationVersionReview["status"];
    note: string | null;
  },
): Promise<void> {
  const now = nowIso();
  await run(
    db,
    `INSERT INTO presentation_version_reviews (id, version_id, reviewed_by_user_id, reviewed_at, status, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), versionId, opts.reviewedByUserId, now, opts.status, opts.note],
  );
}

export async function deletePresentationVersion(db: DatabaseLike, versionId: string): Promise<void> {
  const version = await getPresentationVersion(db, versionId);

  if (version.isCurrent) {
    const latestReview = version.latestReview;
    if (latestReview?.status === "approved") {
      throw new AppError(409, "CANNOT_DELETE_APPROVED", "Cannot delete the currently approved presentation version");
    }
  }

  const now = nowIso();
  await run(db, "UPDATE presentation_versions SET deleted_at = ? WHERE id = ?", [now, versionId]);

  if (version.isCurrent) {
    await run(
      db,
      `UPDATE presentation_versions SET is_current = 1
       WHERE proposal_id = ? AND deleted_at IS NULL
       ORDER BY version_number DESC LIMIT 1`,
      [version.proposalId],
    );
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
