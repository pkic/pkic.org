import { prepareBulkQueueInviteEmailChunkStatements, type InviteEmailQueueRow } from "../../email/outbox";
import { attendeeRegistrationClosesAt, type DueInviteRow } from "../reminders-support";
import type { DatabaseLike, StatementLike } from "../../types";

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
