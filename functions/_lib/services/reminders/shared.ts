import { all } from "../../db/queries";
import { prepareBulkQueueInviteEmailStatements, type InviteEmailQueueRow } from "../../email/outbox";
import { formatInvitePerson, type ProposalInviteEmailContext } from "../proposals";
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
  stateStatements: StatementLike[],
  queuedAt: string,
): Promise<void> {
  const MAX_ROWS = 250;
  for (let i = 0; i < emailRows.length; i += MAX_ROWS) {
    const emailSlice = emailRows.slice(i, i + MAX_ROWS);
    const stateSlice = stateStatements.slice(i, i + MAX_ROWS);
    await db.batch([...prepareBulkQueueInviteEmailStatements(db, emailSlice, queuedAt), ...stateSlice]);
  }
}

export function isAttendeeInviteReminderAllowed(invite: DueInviteRow, nowMs = Date.now()): boolean {
  if (invite.event_starts_at) {
    const startsMs = new Date(invite.event_starts_at).getTime();
    if (Number.isFinite(startsMs) && startsMs <= nowMs) return false;
  }
  const closesAt = attendeeRegistrationClosesAt(invite);
  if (closesAt) {
    const closesMs = new Date(closesAt).getTime();
    if (Number.isFinite(closesMs) && closesMs <= nowMs) return false;
  }
  return true;
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

/**
 * Batch version of buildProposalInviteEmailContext. Fetches all required
 * data for multiple proposals in 3 queries instead of 3×N.
 */
export async function bulkBuildProposalInviteEmailContexts(
  db: DatabaseLike,
  proposalIds: string[],
): Promise<Map<string, ProposalInviteEmailContext>> {
  if (proposalIds.length === 0) return new Map();

  const proposalIdsJson = JSON.stringify(proposalIds);
  const proposals = await all<{ id: string; title: string; abstract: string; proposer_user_id: string }>(
    db,
    `SELECT id, title, abstract, proposer_user_id FROM session_proposals
     WHERE id IN (SELECT value FROM json_each(?))`,
    [proposalIdsJson],
  );

  const proposerUserIds = [...new Set(proposals.map((p) => p.proposer_user_id).filter(Boolean))];
  type UserRow = {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
  };
  type SpeakerRow = {
    proposal_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
  };

  const [proposerUsers, speakerRows] = await Promise.all([
    proposerUserIds.length > 0
      ? all<UserRow>(
          db,
          `SELECT id, email, first_name, last_name, organization_name FROM users WHERE id IN (SELECT value FROM json_each(?))`,
          [JSON.stringify(proposerUserIds)],
        )
      : ([] as UserRow[]),
    all<SpeakerRow>(
      db,
      `SELECT ps.proposal_id, u.email, u.first_name, u.last_name, u.organization_name
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
       WHERE ps.proposal_id IN (SELECT value FROM json_each(?))
       ORDER BY ps.created_at ASC`,
      [proposalIdsJson],
    ),
  ]);

  const proposerById = new Map(proposerUsers.map((u) => [u.id, u]));
  const speakersByProposal = new Map<string, SpeakerRow[]>();
  for (const s of speakerRows) {
    const arr = speakersByProposal.get(s.proposal_id) ?? [];
    arr.push(s);
    speakersByProposal.set(s.proposal_id, arr);
  }

  const result = new Map<string, ProposalInviteEmailContext>();
  for (const proposal of proposals) {
    const proposer = proposerById.get(proposal.proposer_user_id);
    const speakers = speakersByProposal.get(proposal.id) ?? [];
    const speakerLineupText = speakers
      .map((s) => `- ${formatInvitePerson(s.first_name, s.last_name, s.organization_name, s.email)}`)
      .join("\n");
    result.set(proposal.id, {
      invitedByDisplay: proposer
        ? formatInvitePerson(proposer.first_name, proposer.last_name, proposer.organization_name, proposer.email)
        : "The proposer",
      proposalTitle: proposal.title,
      proposalAbstract: proposal.abstract,
      speakerLineupText,
    });
  }
  return result;
}
