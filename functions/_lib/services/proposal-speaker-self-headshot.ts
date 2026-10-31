/**
 * A speaker changes their own photo from their speaker page. The photo is the
 * person's — the same headshot every proposal, badge, agenda and profile
 * shows — so the speaker link alone writes it only while the account's mailbox
 * was never proved; after that it takes the person's live session. Either way
 * the write commits only while the roster row that authorized it is unchanged.
 */
import type { DatabaseLike, Env } from "../types";
import { proposalSpeakerAuthorityCondition, type ProposalSpeakerAuthoritySnapshot } from "./proposal-speaker-authority";
import { speakerAccountAuthorityEvidence, type SpeakerAccountAuthority } from "./proposal-speaker-account-authority";
import { removeUserHeadshotForRequest, uploadUserHeadshotForRequest } from "./user-headshot";

export interface ProposalSpeakerSelfHeadshotContext extends ProposalSpeakerAuthoritySnapshot {
  db: DatabaseLike;
  env: Env;
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  /** The person's headshot read before the write, which the write replaces. */
  headshotKey: string | null;
  accountAuthority: SpeakerAccountAuthority;
}

function commitGuard(context: ProposalSpeakerSelfHeadshotContext): { sql: string; bindings: unknown[] } {
  const roster = proposalSpeakerAuthorityCondition(context);
  const account = speakerAccountAuthorityEvidence(context.accountAuthority, context.userId);
  return { sql: `${roster.sql} AND EXISTS (${account.sql})`, bindings: [...roster.bindings, ...account.bindings] };
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
    commitGuard: commitGuard(context),
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
    commitGuard: commitGuard(context),
  });
}
