import type { DatabaseLike, StatementLike } from "../types";

interface ProposalEmailCancellationInput {
  proposalId: string;
  eventId: string;
  reason: string;
  speakerId?: string;
  speakerUserId?: string;
  conditionSql?: string;
  conditionBindings?: unknown[];
}

/**
 * Cancels durable proposal mail which is no longer valid after a lifecycle or
 * roster transition. Payload metadata is the canonical selector; the speaker
 * id predicate retains compatibility with already-queued invitation rows.
 */
export function prepareCancelProposalEmails(
  db: DatabaseLike,
  input: ProposalEmailCancellationInput,
  now: string,
): StatementLike {
  const speakerFilter = input.speakerUserId ? "AND recipient_user_id = ?" : "";
  const legacyInviteFilter = input.speakerId
    ? "OR instr(idempotency_key, 'proposal_speaker_invite:' || ? || ':') = 1"
    : `OR EXISTS (
         SELECT 1 FROM proposal_speakers ps
         WHERE ps.proposal_id = ?
           AND instr(email_outbox.idempotency_key, 'proposal_speaker_invite:' || ps.id || ':') = 1
       )`;
  const condition = input.conditionSql ? `AND EXISTS (${input.conditionSql})` : "";

  return db
    .prepare(
      `UPDATE email_outbox
       SET status = 'cancelled', last_error = ?, processing_token = NULL,
           lease_expires_at = NULL, updated_at = ?
       WHERE event_id = ? AND status IN ('queued', 'retrying')
         ${speakerFilter}
         AND (
           json_extract(payload_json, '$.proposalId') = ?
           ${legacyInviteFilter}
         )
         ${condition}`,
    )
    .bind(
      input.reason,
      now,
      input.eventId,
      ...(input.speakerUserId ? [input.speakerUserId] : []),
      input.proposalId,
      input.speakerId ?? input.proposalId,
      ...(input.conditionBindings ?? []),
    );
}
