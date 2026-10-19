/**
 * A speaker changes their own photo from their speaker page. The photo is the
 * person's — the same headshot every proposal, badge, agenda and profile
 * shows — so the speaker link authorizes the person's own headshot write,
 * committed only while the roster row that authorized it is unchanged.
 */
import type { DatabaseLike, Env } from "../types";
import { proposalSpeakerAuthorityCondition, type ProposalSpeakerAuthoritySnapshot } from "./proposal-speaker-authority";
import { removeUserHeadshotForRequest, uploadUserHeadshotForRequest } from "./user-headshot";

export interface ProposalSpeakerSelfHeadshotContext extends ProposalSpeakerAuthoritySnapshot {
  db: DatabaseLike;
  env: Env;
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  /** The person's headshot read before the write, which the write replaces. */
  headshotKey: string | null;
}

export function uploadProposalSpeakerSelfHeadshot(
  context: ProposalSpeakerSelfHeadshotContext,
  image: { buffer: ArrayBuffer; contentType: string },
): Promise<{ r2Key: string; origin: string }> {
  return uploadUserHeadshotForRequest(context.db, context.env, context.request, context.waitUntil, {
    userId: context.userId,
    previousKey: context.headshotKey,
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
  });
}

export function removeProposalSpeakerSelfHeadshot(context: ProposalSpeakerSelfHeadshotContext): Promise<void> {
  return removeUserHeadshotForRequest(context.db, context.env, context.request, context.waitUntil, {
    userId: context.userId,
    previousKey: context.headshotKey,
    audit: {
      actorType: "user",
      actorId: context.userId,
      action: "headshot_deleted_by_speaker",
      scope: { type: "proposal", id: context.proposalId },
      details: { proposalId: context.proposalId, speakerUserId: context.userId },
    },
    commitGuard: proposalSpeakerAuthorityCondition(context),
  });
}
