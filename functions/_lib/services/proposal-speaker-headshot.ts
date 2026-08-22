import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { imageExtension, putUploadedImage } from "../utils/image-upload";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { prepareStorageDeletion, withStorageUploadCompensation } from "./storage-deletion-outbox";
import type { HeadshotAudit } from "./user-headshot";

interface ProposalSpeakerHeadshotContext {
  db: DatabaseLike;
  proposalId: string;
  proposalSpeakerId: string;
  speakerUserId: string;
  previousOverrideSet: number;
  previousOverrideKey: string | null;
  /** Optional proposer-authorized proposal snapshot; admins may manage closed proposals. */
  editableProposalSnapshot?: { status: string; updatedAt: string };
  audit: HeadshotAudit;
}

function editableProposalGuard(input: ProposalSpeakerHeadshotContext): { sql: string; bindings: unknown[] } {
  if (!input.editableProposalSnapshot) return { sql: "", bindings: [] };
  return {
    sql: ` AND EXISTS (
             SELECT 1 FROM session_proposals sp
             WHERE sp.id = proposal_speakers.proposal_id
               AND sp.status = ? AND sp.updated_at = ? AND sp.deleted_at IS NULL
           )`,
    bindings: [input.editableProposalSnapshot.status, input.editableProposalSnapshot.updatedAt],
  };
}

/** Store a proposal-roster override without mutating the account-wide user. */
export async function replaceProposalSpeakerHeadshot(
  input: ProposalSpeakerHeadshotContext & {
    bucket: R2Bucket;
    image: { buffer: ArrayBuffer; contentType: string };
    source?: string;
  },
): Promise<string> {
  const at = nowIso();
  const extension = imageExtension(input.image.contentType);
  const r2Key = `proposal-headshots/${input.proposalId}/${input.speakerUserId}/${at.replace(/[:.]/g, "-")}-${uuid().slice(0, 8)}.${extension}`;
  try {
    await withStorageUploadCompensation({
      db: input.db,
      bucket: input.bucket,
      bucketName: "speaker_uploads",
      objectKey: r2Key,
      upload: () =>
        putUploadedImage(input.bucket, r2Key, input.image, "headshot", {
          source: input.source ?? "proposal_manage_upload",
        }),
      prepareCommitStatements: () => {
        const deletion = prepareStorageDeletion(input.db, input.previousOverrideKey, at);
        const proposalGuard = editableProposalGuard(input);
        return [
          input.db
            .prepare(
              `UPDATE proposal_speakers
               SET headshot_override_set = 1, headshot_r2_key = ?, headshot_updated_at = ?
               WHERE id = ? AND proposal_id = ? AND user_id = ?
                 AND headshot_override_set = ? AND headshot_r2_key IS ?${proposalGuard.sql}`,
            )
            .bind(
              r2Key,
              at,
              input.proposalSpeakerId,
              input.proposalId,
              input.speakerUserId,
              input.previousOverrideSet,
              input.previousOverrideKey,
              ...proposalGuard.bindings,
            ),
          prepareAuditLogAfterOneChange(
            input.db,
            input.audit.actorType,
            input.audit.actorId,
            input.audit.action,
            input.audit.entityType ?? "proposal_speaker",
            input.audit.entityId ?? input.proposalSpeakerId,
            { ...input.audit.details, r2Key },
            at,
            input.audit.scope,
          ),
          ...(deletion ? [deletion] : []),
        ];
      },
    });
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "Proposal speaker changed while the headshot was uploaded");
    }
    throw error;
  }
  return r2Key;
}

export async function removeProposalSpeakerHeadshot(input: ProposalSpeakerHeadshotContext): Promise<void> {
  const at = nowIso();
  const deletion = prepareStorageDeletion(input.db, input.previousOverrideKey, at);
  const proposalGuard = editableProposalGuard(input);
  try {
    await input.db.batch([
      input.db
        .prepare(
          `UPDATE proposal_speakers
           SET headshot_override_set = 1, headshot_r2_key = NULL, headshot_updated_at = ?
           WHERE id = ? AND proposal_id = ? AND user_id = ?
             AND headshot_override_set = ? AND headshot_r2_key IS ?${proposalGuard.sql}`,
        )
        .bind(
          at,
          input.proposalSpeakerId,
          input.proposalId,
          input.speakerUserId,
          input.previousOverrideSet,
          input.previousOverrideKey,
          ...proposalGuard.bindings,
        ),
      prepareAuditLogAfterOneChange(
        input.db,
        input.audit.actorType,
        input.audit.actorId,
        input.audit.action,
        input.audit.entityType ?? "proposal_speaker",
        input.audit.entityId ?? input.proposalSpeakerId,
        { ...input.audit.details, previousKey: input.previousOverrideKey },
        at,
        input.audit.scope,
      ),
      ...(deletion ? [deletion] : []),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "Proposal speaker changed while the headshot was removed");
    }
    throw error;
  }
}
