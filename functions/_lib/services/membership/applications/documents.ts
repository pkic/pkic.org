import {
  APPLICATION_DOCUMENT_ALLOWED_MIME_TYPES,
  APPLICATION_DOCUMENT_SORT_KEYS,
  staffApplicationDocumentSchema,
  staffApplicationDocumentsListResponseSchema,
  applicationDocumentSchema,
  applicationDocumentsListResponseSchema,
  type ApplicationDocumentsListQuery,
  type StaffApplicationDocument,
  type ApplicationDocument,
} from "../../../../../assets/shared/schemas/application-documents";
import {
  APPLICATION_TERMINAL_STAGES,
  isApplicationTerminalStage,
} from "../../../../../assets/shared/schemas/member-applications";
import { buildPageInfo, type PageInfo } from "../../../../../assets/shared/schemas/pagination";
import { queryPage, type OffsetPageQuery } from "../../../db/pagination";
import { first } from "../../../db/queries";
import { buildD1TextSearchFilter } from "../../../db/search";
import { resolveMappedOrderBy } from "../../../db/sort";
import { AppError } from "../../../errors";
import type { DatabaseLike, StatementLike } from "../../../types";
import { sha256Hex } from "../../../utils/crypto";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { prepareAuditLog } from "../../audit";
import { withStorageUploadCompensation } from "../../storage-deletion-outbox";

const APPLICATION_DOCUMENT_ORDER_COLUMNS: Record<(typeof APPLICATION_DOCUMENT_SORT_KEYS)[number], string> = {
  filename: "filename",
  mimeType: "mime_type",
  fileSizeBytes: "file_size_bytes",
  uploadedAt: "uploaded_at",
};

const APPLICATION_DOCUMENT_INSERT_REJECTED = "APPLICATION_DOCUMENT_INSERT_REJECTED";
const APPLICATION_TERMINAL_STAGE_PLACEHOLDERS = APPLICATION_TERMINAL_STAGES.map(() => "?").join(", ");

export interface ApplicationDocumentLimits {
  maxFileBytes: number;
  maxDocumentCount: number;
  maxTotalBytes: number;
}

interface ApplicationDocumentListRow {
  id: string;
  application_id: string;
  uploaded_by_email: string;
  filename: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
}

interface ApplicationDocumentRow extends ApplicationDocumentListRow {
  r2_key: string;
  content_sha256: string;
  idempotency_key_hash: string | null;
}

interface ApplicationDocumentUsage {
  document_count: number;
  total_bytes: number;
}

interface ApplicationDocumentPageStatements {
  page: OffsetPageQuery;
}

function toApplicationDocument(row: ApplicationDocumentListRow): ApplicationDocument {
  return applicationDocumentSchema.parse({
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    uploadedAt: row.uploaded_at,
  });
}

function toStaffApplicationDocument(row: ApplicationDocumentListRow): StaffApplicationDocument {
  return staffApplicationDocumentSchema.parse({
    ...toApplicationDocument(row),
    uploadedByEmail: row.uploaded_by_email,
  });
}

export function buildApplicationDocumentPageStatements(
  applicationId: string,
  query: ApplicationDocumentsListQuery,
): ApplicationDocumentPageStatements {
  const conditions = ["application_id = ?"];
  const bindings: unknown[] = [applicationId];
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["filename", "mime_type", "uploaded_by_email"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(query.sort, APPLICATION_DOCUMENT_ORDER_COLUMNS, "uploaded_at DESC", "id ASC");
  return {
    page: {
      sql: `SELECT id, application_id, uploaded_by_email, filename, mime_type,
                   file_size_bytes, uploaded_at
              FROM application_documents
              ${where}`,
      bindings,
      orderBy,
      limit: query.limit,
      offset: query.offset,
    },
  };
}

async function queryApplicationDocuments(
  db: DatabaseLike,
  applicationId: string,
  query: ApplicationDocumentsListQuery,
): Promise<{ rows: ApplicationDocumentListRow[]; page: PageInfo }> {
  const statements = buildApplicationDocumentPageStatements(applicationId, query);
  const { rows, total } = await queryPage<ApplicationDocumentListRow>(db, statements.page);
  return { rows, page: buildPageInfo(query.limit, query.offset, total, rows.length) };
}

export async function listApplicationDocuments(
  db: DatabaseLike,
  applicationId: string,
  query: ApplicationDocumentsListQuery,
): Promise<{ documents: ApplicationDocument[]; page: PageInfo }> {
  const result = await queryApplicationDocuments(db, applicationId, query);
  return applicationDocumentsListResponseSchema.parse({
    documents: result.rows.map(toApplicationDocument),
    page: result.page,
  });
}

export async function listStaffApplicationDocuments(
  db: DatabaseLike,
  applicationId: string,
  query: ApplicationDocumentsListQuery,
): Promise<{ documents: StaffApplicationDocument[]; page: PageInfo }> {
  const result = await queryApplicationDocuments(db, applicationId, query);
  return staffApplicationDocumentsListResponseSchema.parse({
    documents: result.rows.map(toStaffApplicationDocument),
    page: result.page,
  });
}

function normalizeFilename(name: string): string {
  const normalized = name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "_");
  const withoutLeadingDots = normalized.replace(/^\.+/, "");
  const safe = withoutLeadingDots.replace(/_+/g, "_").slice(0, 100);
  return safe && safe !== "." && safe !== ".." ? safe : "document";
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function detectDocumentMimeType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "application/msword";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

async function validateUploadFile(file: File, limits: ApplicationDocumentLimits) {
  if (file.size < 1) {
    throw new AppError(400, "EMPTY_FILE", "The uploaded document is empty");
  }
  if (file.size > limits.maxFileBytes) {
    throw new AppError(413, "FILE_TOO_LARGE", `File exceeds the ${limits.maxFileBytes}-byte limit`);
  }
  if (!(APPLICATION_DOCUMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported document type");
  }
  const contents = await file.arrayBuffer();
  const prefix = new Uint8Array(contents, 0, Math.min(contents.byteLength, 1024));
  if (detectDocumentMimeType(prefix) !== file.type) {
    throw new AppError(415, "DOCUMENT_TYPE_MISMATCH", "Document contents do not match the declared file type");
  }
  return {
    filename: normalizeFilename(file.name || "document"),
    mimeType: file.type,
    fileSizeBytes: file.size,
    contentSha256: await sha256Hex(contents),
  };
}

async function getApplicationDocumentUsage(db: DatabaseLike, applicationId: string): Promise<ApplicationDocumentUsage> {
  return (
    (await first<ApplicationDocumentUsage>(
      db,
      `SELECT COUNT(*) AS document_count, COALESCE(SUM(file_size_bytes), 0) AS total_bytes
         FROM application_documents
        WHERE application_id = ?`,
      [applicationId],
    )) ?? { document_count: 0, total_bytes: 0 }
  );
}

async function getApplicationStage(db: DatabaseLike, applicationId: string): Promise<string | null> {
  return (
    (await first<{ stage: string }>(db, "SELECT stage FROM member_applications WHERE id = ?", [applicationId]))
      ?.stage ?? null
  );
}

function assertApplicationOpen(stage: string | null): void {
  if (stage === null || isApplicationTerminalStage(stage)) {
    throw new AppError(409, "APPLICATION_CLOSED", "Documents cannot be uploaded to a closed application");
  }
}

function assertQuota(usage: ApplicationDocumentUsage, incomingBytes: number, limits: ApplicationDocumentLimits): void {
  if (Number(usage.document_count) >= limits.maxDocumentCount) {
    throw new AppError(409, "DOCUMENT_COUNT_LIMIT_REACHED", "The application document count limit has been reached");
  }
  if (Number(usage.total_bytes) + incomingBytes > limits.maxTotalBytes) {
    throw new AppError(
      413,
      "DOCUMENT_STORAGE_LIMIT_REACHED",
      "The application document storage limit has been reached",
    );
  }
}

async function findIdempotentDocument(
  db: DatabaseLike,
  applicationId: string,
  idempotencyKeyHash: string,
): Promise<ApplicationDocumentRow | null> {
  return first<ApplicationDocumentRow>(
    db,
    `SELECT id, application_id, uploaded_by_email, r2_key, filename, mime_type,
            file_size_bytes, content_sha256, uploaded_at, idempotency_key_hash
       FROM application_documents
      WHERE application_id = ? AND idempotency_key_hash = ?`,
    [applicationId, idempotencyKeyHash],
  );
}

function assertIdempotentRequestMatches(
  existing: ApplicationDocumentRow,
  file: { filename: string; mimeType: string; fileSizeBytes: number; contentSha256: string },
): void {
  if (
    existing.filename !== file.filename ||
    existing.mime_type !== file.mimeType ||
    existing.file_size_bytes !== file.fileSizeBytes ||
    existing.content_sha256 !== file.contentSha256
  ) {
    throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for a different document");
  }
}

function prepareDocumentStatements(
  db: DatabaseLike,
  row: ApplicationDocumentRow,
  limits: ApplicationDocumentLimits,
): StatementLike[] {
  return [
    db
      .prepare(
        `INSERT INTO application_documents
           (id, application_id, uploaded_by_email, r2_key, filename, mime_type,
            file_size_bytes, content_sha256, uploaded_at, idempotency_key_hash)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
                  SELECT 1 FROM member_applications
                   WHERE id = ? AND stage NOT IN (${APPLICATION_TERMINAL_STAGE_PLACEHOLDERS})
                )
            AND (SELECT COUNT(*) FROM application_documents WHERE application_id = ?) < ?
            AND (SELECT COALESCE(SUM(file_size_bytes), 0)
                   FROM application_documents WHERE application_id = ?) + ? <= ?
         ON CONFLICT(application_id, idempotency_key_hash)
           WHERE idempotency_key_hash IS NOT NULL DO NOTHING`,
      )
      .bind(
        row.id,
        row.application_id,
        row.uploaded_by_email,
        row.r2_key,
        row.filename,
        row.mime_type,
        row.file_size_bytes,
        row.content_sha256,
        row.uploaded_at,
        row.idempotency_key_hash,
        row.application_id,
        ...APPLICATION_TERMINAL_STAGES,
        row.application_id,
        limits.maxDocumentCount,
        row.application_id,
        row.file_size_bytes,
        limits.maxTotalBytes,
      ),
    db.prepare("INSERT INTO application_document_insert_guards (id, document_id) VALUES (?, ?)").bind(uuid(), row.id),
    prepareAuditLog(
      db,
      "public",
      null,
      "application_document_uploaded",
      "member_application",
      row.application_id,
      {
        documentId: row.id,
        filename: row.filename,
        fileSize: row.file_size_bytes,
        mimeType: row.mime_type,
        contentSha256: row.content_sha256,
      },
      row.uploaded_at,
    ),
  ];
}

function isApplicationDocumentInsertRejected(error: unknown): boolean {
  return error instanceof Error && error.message.includes(APPLICATION_DOCUMENT_INSERT_REJECTED);
}

export async function uploadApplicationDocument(input: {
  db: DatabaseLike;
  bucket: R2Bucket;
  applicationId: string;
  applicationStage: string;
  uploadedByEmail: string;
  file: File;
  idempotencyKey: string;
  limits: ApplicationDocumentLimits;
}): Promise<ApplicationDocument> {
  const file = await validateUploadFile(input.file, input.limits);
  const idempotencyKeyHash = await sha256Hex(input.idempotencyKey);
  const existing = await findIdempotentDocument(input.db, input.applicationId, idempotencyKeyHash);
  if (existing) {
    assertIdempotentRequestMatches(existing, file);
    return toApplicationDocument(existing);
  }

  assertApplicationOpen(input.applicationStage);
  assertQuota(await getApplicationDocumentUsage(input.db, input.applicationId), file.fileSizeBytes, input.limits);

  const row: ApplicationDocumentRow = {
    id: uuid(),
    application_id: input.applicationId,
    uploaded_by_email: input.uploadedByEmail,
    r2_key: `application-docs/${input.applicationId}/${uuid()}-${file.filename}`,
    filename: file.filename,
    mime_type: file.mimeType,
    file_size_bytes: file.fileSizeBytes,
    content_sha256: file.contentSha256,
    uploaded_at: nowIso(),
    idempotency_key_hash: idempotencyKeyHash,
  };

  try {
    await withStorageUploadCompensation({
      db: input.db,
      bucket: input.bucket,
      bucketName: "assets",
      objectKey: row.r2_key,
      upload: async () => {
        try {
          await input.bucket.put(row.r2_key, input.file.stream(), { httpMetadata: { contentType: file.mimeType } });
        } catch {
          throw new AppError(503, "UPLOAD_FAILED", "Document storage is temporarily unavailable");
        }
      },
      prepareCommitStatements: () => prepareDocumentStatements(input.db, row, input.limits),
    });
  } catch (error) {
    if (!isApplicationDocumentInsertRejected(error)) throw error;

    const concurrentExisting = await findIdempotentDocument(input.db, input.applicationId, idempotencyKeyHash);
    if (concurrentExisting) {
      assertIdempotentRequestMatches(concurrentExisting, file);
      return toApplicationDocument(concurrentExisting);
    }
    assertApplicationOpen(await getApplicationStage(input.db, input.applicationId));
    assertQuota(await getApplicationDocumentUsage(input.db, input.applicationId), file.fileSizeBytes, input.limits);
    throw new AppError(409, "DOCUMENT_UPLOAD_CONFLICT", "The application changed while the document was uploaded");
  }

  return toApplicationDocument(row);
}
