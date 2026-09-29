import { prepareBulkQueueInviteEmailChunkStatements, type InviteEmailQueueRow } from "../../email/outbox";
import { attendeeRegistrationClosesAt, type DueInviteRow } from "../reminders-support";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { stringifyJson } from "../../utils/json";
import { effectiveProposalSpeakerInviteExpirySql, inactiveEffectiveInviteExpirySql } from "../../invite-validity";

export interface SpeakerReminderRecipientSnapshot {
  speakerId: string;
  userId: string;
  normalizedEmail: string;
}

/** Rechecks a bounded reminder slice against canonical speaker ownership/email in the commit batch. */
export function prepareSpeakerReminderRecipientGuard(
  db: DatabaseLike,
  snapshots: SpeakerReminderRecipientSnapshot[],
): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            WHERE NOT EXISTS (
              SELECT 1
                FROM json_each(?) candidate
                LEFT JOIN proposal_speakers ps
                  ON ps.id = json_extract(candidate.value, '$.speakerId')
                LEFT JOIN users u ON u.id = ps.user_id
               WHERE ps.id IS NULL
                  OR ps.user_id != json_extract(candidate.value, '$.userId')
                  OR u.normalized_email != json_extract(candidate.value, '$.normalizedEmail')
            )`,
    bindings: [stringifyJson(snapshots)],
  });
}

export interface CoSpeakerInviteReminderSnapshot extends SpeakerReminderRecipientSnapshot {
  proposalId: string;
  proposalStatus: string;
  eventId: string;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  inviteExpiresAt: string | null;
}

/** Rechecks recipient, proposal state, and the event-bounded invitation deadline in one D1 batch. */
export function prepareCoSpeakerInviteReminderGuard(
  db: DatabaseLike,
  snapshots: CoSpeakerInviteReminderSnapshot[],
  now: string,
): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            WHERE NOT EXISTS (
              SELECT 1
                FROM json_each(?) candidate
                LEFT JOIN proposal_speakers ps
                  ON ps.id = json_extract(candidate.value, '$.speakerId')
                LEFT JOIN session_proposals sp ON sp.id = ps.proposal_id
                LEFT JOIN events e ON e.id = sp.event_id
                LEFT JOIN users u ON u.id = ps.user_id
               WHERE ps.id IS NULL
                  OR ps.user_id != json_extract(candidate.value, '$.userId')
                  OR ps.proposal_id != json_extract(candidate.value, '$.proposalId')
                  OR ps.status != 'invited'
                  OR ps.invite_expires_at IS NOT json_extract(candidate.value, '$.inviteExpiresAt')
                  OR u.normalized_email != json_extract(candidate.value, '$.normalizedEmail')
                  OR sp.status != json_extract(candidate.value, '$.proposalStatus')
                  OR e.id != json_extract(candidate.value, '$.eventId')
                  OR e.starts_at IS NOT json_extract(candidate.value, '$.eventStartsAt')
                  OR e.ends_at IS NOT json_extract(candidate.value, '$.eventEndsAt')
                  OR (${inactiveEffectiveInviteExpirySql(effectiveProposalSpeakerInviteExpirySql("ps", "e"))})
            )`,
    bindings: [stringifyJson(snapshots), now],
  });
}

/** Runs D1 statements in chunks of 500 to respect batch limits. */
export async function batchStatements(db: DatabaseLike, stmts: StatementLike[]): Promise<void> {
  if (stmts.length === 0) return;
  const MAX = 500;
  for (let i = 0; i < stmts.length; i += MAX) {
    await db.batch(stmts.slice(i, i + MAX));
  }
}

export async function batchQueueEmailsAndUpdateState(
  db: DatabaseLike,
  emailRows: InviteEmailQueueRow[],
  stateStatements: Array<StatementLike | StatementLike[]>,
  queuedAt: string,
  options: {
    isExpectedConflict?: (error: unknown) => boolean;
    prepareSliceStatements?: (start: number, end: number) => StatementLike[];
  } = {},
): Promise<number> {
  const MAX_ROWS = 250;
  let committed = 0;

  const commitSlice = async (start: number, end: number): Promise<number> => {
    const emailSlice = emailRows.slice(start, end);
    const stateSlice = stateStatements
      .slice(start, end)
      .flatMap((statements) => (Array.isArray(statements) ? statements : [statements]));
    try {
      const emailStatements = prepareBulkQueueInviteEmailChunkStatements(db, emailSlice, queuedAt).map(
        (chunk) => chunk.statement,
      );
      await db.batch([...(options.prepareSliceStatements?.(start, end) ?? []), ...emailStatements, ...stateSlice]);
      return emailSlice.length;
    } catch (error) {
      if (!options.isExpectedConflict?.(error)) throw error;
      if (emailSlice.length === 1) return 0;
      const midpoint = start + Math.floor((end - start) / 2);
      return (await commitSlice(start, midpoint)) + (await commitSlice(midpoint, end));
    }
  };

  for (let i = 0; i < emailRows.length; i += MAX_ROWS) {
    committed += await commitSlice(i, Math.min(i + MAX_ROWS, emailRows.length));
  }
  return committed;
}

export function attendeeEffectiveDeadline(invite: DueInviteRow): string | null {
  const candidates = [invite.expires_at, attendeeRegistrationClosesAt(invite)].filter((v): v is string => Boolean(v));
  if (candidates.length === 0) return null;
  let minIso = candidates[0];
  let minTs = new Date(minIso).getTime();
  for (const iso of candidates.slice(1)) {
    const ts = new Date(iso).getTime();
    if (Number.isFinite(ts) && ts < minTs) {
      minTs = ts;
      minIso = iso;
    }
  }
  return minIso;
}
