import type { DatabaseLike, Env, StatementLike } from "../types";
import { prepareAuditLogAfterOneChange } from "./audit";
import { prepareStorageDeletion } from "./storage-deletion-outbox";
import { proposalSpeakerAuthorityCondition } from "./proposal-speaker-profile-overrides";
import { removeUserHeadshotForRequest, uploadUserHeadshotForRequest } from "./user-headshot";

export interface ProposalSpeakerSelfHeadshotContext {
  db: DatabaseLike;
  env: Env;
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  proposalId: string;
  proposalSpeakerId: string;
  userId: string;
  proposalStatus: string;
  proposalUpdatedAt: string;
  currentStatus: string;
  accountHeadshotKey: string | null;
  proposalOverrideSet: number;
  proposalOverrideKey: string | null;
}

function prepareClearOverrideStatements(context: ProposalSpeakerSelfHeadshotContext, at: string): StatementLike[] {
  if (context.proposalOverrideSet !== 1) return [];
  const deletion = prepareStorageDeletion(context.db, context.proposalOverrideKey, at);
  const authority = proposalSpeakerAuthorityCondition(context);
  return [
    context.db
      .prepare(
        `UPDATE proposal_speakers
         SET headshot_override_set = 0, headshot_r2_key = NULL, headshot_updated_at = NULL
         WHERE ${authority.sql}
           AND headshot_override_set = ? AND headshot_r2_key IS ?`,
      )
      .bind(...authority.bindings, context.proposalOverrideSet, context.proposalOverrideKey),
    prepareAuditLogAfterOneChange(
      context.db,
      "user",
      context.userId,
      "proposal_speaker_headshot_override_cleared",
      "proposal_speaker",
      context.proposalSpeakerId,
      { proposalId: context.proposalId, speakerUserId: context.userId },
      at,
      { type: "proposal", id: context.proposalId },
    ),
    ...(deletion ? [deletion] : []),
  ];
}

export function uploadProposalSpeakerSelfHeadshot(
  context: ProposalSpeakerSelfHeadshotContext,
  image: { buffer: ArrayBuffer; contentType: string },
): Promise<{ r2Key: string; origin: string }> {
  return uploadUserHeadshotForRequest(context.db, context.env, context.request, context.waitUntil, {
    userId: context.userId,
    previousKey: context.accountHeadshotKey,
    image,
    source: "speaker_self_upload",
    audit: {
      actorType: "user",
      actorId: context.userId,
      action: "headshot_uploaded_by_speaker",
      scope: { type: "proposal", id: context.proposalId },
      details: { proposalId: context.proposalId, speakerUserId: context.userId },
    },
    commitGuard: proposalSpeakerAuthorityCondition(context),
    prepareAdditionalCommitStatements: (at) => prepareClearOverrideStatements(context, at),
  });
}

export function removeProposalSpeakerSelfHeadshot(context: ProposalSpeakerSelfHeadshotContext): Promise<void> {
  return removeUserHeadshotForRequest(context.db, context.env, context.request, context.waitUntil, {
    userId: context.userId,
    previousKey: context.accountHeadshotKey,
    audit: {
      actorType: "user",
      actorId: context.userId,
      action: "headshot_deleted_by_speaker",
      scope: { type: "proposal", id: context.proposalId },
      details: { proposalId: context.proposalId, speakerUserId: context.userId },
    },
    commitGuard: proposalSpeakerAuthorityCondition(context),
    prepareAdditionalCommitStatements: (at) => prepareClearOverrideStatements(context, at),
  });
}
