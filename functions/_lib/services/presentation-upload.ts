import {
  ALLOWED_PRESENTATION_MIME_TYPES,
  MAX_PRESENTATION_BYTES,
  PRESENTATION_FILE_NAME_HEADER,
  PRESENTATION_FILE_SIZE_HEADER,
} from "../../../assets/shared/presentation-upload";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, Env } from "../types";
import { adminDatabaseUserId } from "../auth/admin-identity";
import { uuid } from "../utils/ids";
import {
  getPresentationProposalContext,
  preparePresentationVersionCreate,
  type PresentationProposalContext,
} from "./presentation-versions";
import { withStorageUploadCompensation } from "./storage-deletion-outbox";

const ALLOWED_PRESENTATION_TYPES = new Set<string>(ALLOWED_PRESENTATION_MIME_TYPES);

export interface PresentationUpload {
  body: ReadableStream<Uint8Array>;
  name: string;
  size: number;
  type: string;
}

export interface PresentationStorageContext {
  eventSlug: string;
  proposalId: string;
  proposalTitle: string;
}

type PresentationUploadActor = { type: "admin"; admin: AuthAdmin } | { type: "user"; userId: string };

type PresentationUploadError = { error: { code: string; message: string }; status: number };

export function parsePresentationUpload(request: Request): PresentationUpload | PresentationUploadError {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_PRESENTATION_TYPES.has(type)) {
    return {
      error: { code: "INVALID_FILE_TYPE", message: "Only PDF and PowerPoint (PPTX/PPT/PPTM/ODP) files are accepted." },
      status: 415,
    };
  }

  const encodedName = request.headers.get(PRESENTATION_FILE_NAME_HEADER);
  let name: string;
  try {
    name = encodedName ? decodeURIComponent(encodedName) : "";
  } catch {
    return { error: { code: "INVALID_FILE_NAME", message: "Presentation file name is invalid." }, status: 400 };
  }
  if (!name || name.length > 255) {
    return { error: { code: "INVALID_FILE_NAME", message: "Presentation file name is invalid." }, status: 400 };
  }

  const declaredSize = Number(request.headers.get(PRESENTATION_FILE_SIZE_HEADER));
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
    return { error: { code: "INVALID_FILE_SIZE", message: "Presentation file size is invalid." }, status: 400 };
  }
  if (declaredSize > MAX_PRESENTATION_BYTES) {
    return { error: { code: "FILE_TOO_LARGE", message: "Presentation must be 100 MB or smaller." }, status: 413 };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) !== declaredSize) {
    return {
      error: { code: "FILE_SIZE_MISMATCH", message: "Presentation file size does not match the request." },
      status: 400,
    };
  }
  if (!request.body) {
    return { error: { code: "MISSING_FILE", message: "A presentation file is required." }, status: 400 };
  }

  return { body: request.body, name, size: declaredSize, type };
}

function storagePathSegment(value: string, fallback: string, maxLength = 100): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength)
      .replace(/-+$/g, "") || fallback
  );
}

export async function storePresentationFile(
  bucket: R2Bucket,
  context: PresentationStorageContext,
  upload: PresentationUpload,
  preparedR2Key?: string,
): Promise<string> {
  const eventSlug = storagePathSegment(context.eventSlug, "event");
  const proposalTitle = storagePathSegment(context.proposalTitle, "proposal");
  const proposalId = storagePathSegment(context.proposalId, "unknown", 64);
  const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "presentation";
  const r2Key =
    preparedR2Key ?? `presentations/${eventSlug}/${proposalTitle}--${proposalId}/${Date.now()}-${uuid()}-${safeName}`;
  const stored = await bucket.put(r2Key, upload.body, { httpMetadata: { contentType: upload.type } });
  if (stored.size !== upload.size) {
    throw new AppError(400, "FILE_SIZE_MISMATCH", "Presentation file size does not match the request.");
  }
  return r2Key;
}

export function requirePresentationBucket(env: Pick<Env, "SPEAKER_UPLOADS_BUCKET">): R2Bucket {
  const bucket = env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured on this instance.");
  }
  return bucket;
}

export async function uploadProposalPresentation(
  db: DatabaseLike,
  bucket: R2Bucket,
  request: Request,
  context: PresentationProposalContext,
  payload: {
    actor: PresentationUploadActor;
    enforceDeadline: boolean;
  },
): Promise<string> {
  if (context.status !== "accepted") {
    throw new AppError(409, "PROPOSAL_NOT_ACCEPTED", "Presentations can only be uploaded for accepted proposals.");
  }
  if (
    payload.enforceDeadline &&
    context.presentation_deadline &&
    new Date(context.presentation_deadline) < new Date()
  ) {
    throw new AppError(
      409,
      "DEADLINE_PASSED",
      "The presentation upload deadline has passed. Please contact the organizer.",
    );
  }

  const parsed = parsePresentationUpload(request);
  if ("error" in parsed) throw new AppError(parsed.status, parsed.error.code, parsed.error.message);
  const eventSlug = storagePathSegment(context.event_slug, "event");
  const proposalTitle = storagePathSegment(context.title, "proposal");
  const proposalId = storagePathSegment(context.id, "unknown", 64);
  const safeName = parsed.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "presentation";
  const r2Key = `presentations/${eventSlug}/${proposalTitle}--${proposalId}/${Date.now()}-${uuid()}-${safeName}`;
  const uploadedByUserId =
    payload.actor.type === "admin" ? adminDatabaseUserId(payload.actor.admin) : payload.actor.userId;
  const auditActorId = payload.actor.type === "admin" ? payload.actor.admin.id : payload.actor.userId;
  const prepared = preparePresentationVersionCreate(
    db,
    context.id,
    {
      r2Key,
      uploadedByUserId,
      fileName: parsed.name,
      fileSize: parsed.size,
      mimeType: parsed.type,
    },
    { actorType: payload.actor.type, actorId: auditActorId, action: "presentation_uploaded" },
  );
  await withStorageUploadCompensation({
    db,
    bucket,
    bucketName: "speaker_uploads",
    objectKey: r2Key,
    upload: async () => {
      // FixedLengthStream keeps the R2 object uncommitted until exactly the
      // declared number of bytes has arrived. The counting transform rejects
      // oversized or dishonest streams before they reach R2 and preserves a
      // route-specific error contract for the API response.
      let total = 0;
      const counted = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          if (total > MAX_PRESENTATION_BYTES) {
            throw new AppError(413, "FILE_TOO_LARGE", "Presentation must be 100 MB or smaller.");
          }
          if (total > parsed.size) {
            throw new AppError(400, "FILE_SIZE_MISMATCH", "Presentation file size does not match the request.");
          }
          controller.enqueue(chunk);
        },
        flush() {
          if (total !== parsed.size) {
            throw new AppError(400, "FILE_SIZE_MISMATCH", "Presentation file size does not match the request.");
          }
        },
      });
      const fixed = new FixedLengthStream(parsed.size);
      const putPromise = storePresentationFile(
        bucket,
        { eventSlug: context.event_slug, proposalId: context.id, proposalTitle: context.title },
        { ...parsed, body: fixed.readable },
        r2Key,
      );
      try {
        await parsed.body.pipeThrough(counted).pipeTo(fixed.writable);
      } catch (error) {
        await putPromise.catch(() => undefined);
        throw error;
      }
      return await putPromise;
    },
    prepareCommitStatements: () => prepared.statements,
  });
  return r2Key;
}

export { getPresentationProposalContext };
