import {
  SESSION_PRESENTATION_SOURCE_KEY_HEADER,
  SESSION_PRESENTATION_SOURCE_DIGEST_HEADER,
  sessionPresentationSourceKeySchema,
  sessionPresentationDigestSchema,
} from "../../../../assets/shared/schemas/session-presentation-versions";
import { parsePresentationUpload, streamPresentationUpload } from "../presentation-upload";
import { withStorageUploadCompensation } from "../storage-deletion-outbox";
import { prepareScopedAuditLog } from "../audit";
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import {
  requireSessionPresentation,
  sessionPresentationWriteGuards,
  sessionPresentationFailure,
  getSessionPresentation,
  publicSessionPresentationVersion,
  type SessionPresentationAuthority,
} from "./session-presentations";
export async function uploadSessionPresentation(
  db: DatabaseLike,
  bucket: R2Bucket,
  authority: SessionPresentationAuthority,
  request: Request,
) {
  await requireSessionPresentation(db, authority, true);
  const parsed = parsePresentationUpload(request);
  if ("error" in parsed) throw new AppError(parsed.status, parsed.error.code, parsed.error.message);
  const encodedSource = request.headers.get(SESSION_PRESENTATION_SOURCE_KEY_HEADER);
  const expectedDigest = request.headers.get(SESSION_PRESENTATION_SOURCE_DIGEST_HEADER);
  let sourceKey: string | null = null;
  if (encodedSource || expectedDigest) {
    try {
      sourceKey = sessionPresentationSourceKeySchema.parse(decodeURIComponent(encodedSource ?? ""));
    } catch {
      throw new AppError(400, "INVALID_PRESENTATION_SOURCE", "Use a repository-relative source key and SHA-256 digest");
    }
    if (!sessionPresentationDigestSchema.safeParse(expectedDigest).success)
      throw new AppError(400, "INVALID_PRESENTATION_SOURCE", "Supply a SHA-256 source digest");
    const existing = await first<{
      id: string;
      deleted_at: string | null;
      file_name: string;
      file_size: number;
      mime_type: string;
    }>(
      db,
      "SELECT id,deleted_at,file_name,file_size,mime_type FROM session_presentation_versions WHERE event_id=? AND occurrence_id=? AND source_key=? AND source_digest=?",
      [authority.eventId, authority.occurrenceId, sourceKey, expectedDigest],
    );
    if (existing) {
      if (existing.deleted_at)
        throw new AppError(
          409,
          "PRESENTATION_SOURCE_DELETED",
          "This source version was deleted; review it before importing again",
        );
      if (
        existing.file_name !== parsed.name ||
        existing.file_size !== parsed.size ||
        existing.mime_type !== parsed.type
      )
        throw new AppError(
          409,
          "PRESENTATION_SOURCE_CONFLICT",
          "The source digest is already bound to different upload metadata",
        );
      await parsed.body.cancel();
      return {
        version: publicSessionPresentationVersion(await getSessionPresentation(db, authority, existing.id, true)),
      };
    }
  }
  let sourceDigest = "";
  const prior = await first<{ number: number }>(
    db,
    "SELECT COALESCE(MAX(version_number),0) AS number FROM session_presentation_versions WHERE occurrence_id=?",
    [authority.occurrenceId],
  );
  const versionId = crypto.randomUUID(),
    previous = prior?.number ?? 0;
  const r2Key = `session-presentations/${authority.eventId}/${authority.occurrenceId}/${versionId}`;
  try {
    await withStorageUploadCompensation({
      db,
      bucket,
      bucketName: "speaker_uploads",
      objectKey: r2Key,
      upload: async () => {
        // Workers extends Crypto; the DOM declaration does not expose this constructor.
        const Digest = (crypto as Crypto & { DigestStream: typeof DigestStream }).DigestStream;
        const hash = new Digest("SHA-256"),
          writer = hash.getWriter();
        const hashing = new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) {
            await writer.write(chunk);
            controller.enqueue(chunk);
          },
          async flush() {
            await writer.close();
          },
        });
        const digest = hash.digest.then((value) =>
          Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join(""),
        );
        try {
          const [, actual] = await Promise.all([
            streamPresentationUpload(bucket, r2Key, { ...parsed, body: parsed.body.pipeThrough(hashing) }),
            digest,
          ]);
          sourceDigest = actual;
          if (expectedDigest && actual !== expectedDigest)
            throw new AppError(
              400,
              "PRESENTATION_SOURCE_DIGEST_MISMATCH",
              "The uploaded bytes do not match the source digest",
            );
        } catch (error) {
          await writer.abort(error).catch(() => undefined);
          throw error;
        }
      },
      prepareCommitStatements: () => {
        const guard = sessionPresentationWriteGuards(db, authority, {
          sql: "(SELECT COALESCE(MAX(version_number),0) FROM session_presentation_versions WHERE occurrence_id=?)=?",
          bindings: [authority.occurrenceId, previous],
        });
        return [
          ...guard.statements,
          db
            .prepare("UPDATE session_presentation_versions SET is_current=0 WHERE occurrence_id=? AND is_current=1")
            .bind(authority.occurrenceId),
          db
            .prepare(
              "INSERT INTO session_presentation_versions(id,event_id,occurrence_id,version_number,r2_key,file_name,file_size,mime_type,source_key,source_digest,uploaded_by_user_id,uploaded_at,is_current) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)",
            )
            .bind(
              versionId,
              authority.eventId,
              authority.occurrenceId,
              previous + 1,
              r2Key,
              parsed.name,
              parsed.size,
              parsed.type,
              sourceKey,
              sourceDigest,
              authority.actor.id,
              nowIso(),
            ),
          prepareScopedAuditLog(
            db,
            { type: "event", id: authority.eventId },
            "user",
            authority.actor.id,
            "session.presentation.uploaded",
            "session_presentation",
            versionId,
            { occurrenceId: authority.occurrenceId, versionNumber: previous + 1 },
          ),
          guard.cleanup,
        ];
      },
    });
  } catch (error) {
    sessionPresentationFailure(error);
  }
  return { version: publicSessionPresentationVersion(await getSessionPresentation(db, authority, versionId, true)) };
}
