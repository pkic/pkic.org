/**
 * Ballot eligibility and submission. Split out of votes.ts.
 */
import { all, first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import { REPRESENTATIVE_ROLE_IDS, resolveRepresentativeRoleHolders } from "../membership/representative-roles";
import {
  getVoteRowOrThrow,
  eligibleCategoriesOf,
  assertVotingCategory,
  toVoteSummary,
  MOTION_CHOICES,
  type VoteRow,
  type VoteSummary,
  type BallotChoice,
} from "./shared";
import type { AuthMember, DatabaseLike, StatementLike } from "../../types";

/** role-voting_delegate (user_roles, context_type='organization') falls back to role-primary_contact when unset. */
export async function resolveVotingDelegateUserId(db: DatabaseLike, organizationId: string): Promise<string | null> {
  const org = await first<{ member_id: string }>(db, `SELECT id AS member_id FROM members WHERE organization_id = ?`, [
    organizationId,
  ]);
  if (!org) return null;
  const holders = await resolveRepresentativeRoleHolders(db, org.member_id);
  return holders.votingDelegateUserId ?? holders.primaryContactUserId;
}

export interface ForumVoteDelegateRecipient {
  organizationId: string;
  organizationName: string;
  delegateUserId: string;
  delegateEmail: string;
  delegateName: string;
}

/**
 * Every active member organization's resolved voting delegate for a forum
 * vote — used by the scheduled-jobs pass to queue
 * `forum-vote-delegate-notify` on initial open and on each round advance
 * ("When a vote opens, the portal notifies the current delegate by
 * email"). Returns null for non-forum votes.
 */
export async function resolveForumVoteDelegateRecipients(
  db: DatabaseLike,
  voteId: string,
): Promise<{ vote: VoteSummary; recipients: ForumVoteDelegateRecipient[] } | null> {
  const row = await getVoteRowOrThrow(db, voteId);
  if (row.scope_type !== "forum") return null;

  const orgs = await all<{ id: string; name: string; delegate_user_id: string | null }>(
    db,
    `SELECT o.id, o.name,
            COALESCE(vd.user_id, pc.user_id) AS delegate_user_id,
            u.email AS delegate_email,
            u.first_name AS delegate_first_name,
            u.last_name AS delegate_last_name
     FROM organizations o
     JOIN members m ON m.organization_id = o.id AND m.status = 'active'
     LEFT JOIN user_roles vd ON vd.context_type = 'organization' AND vd.context_id = m.id
       AND vd.role_id = '${REPRESENTATIVE_ROLE_IDS.votingDelegate}' AND vd.revoked_at IS NULL
     LEFT JOIN user_roles pc ON pc.context_type = 'organization' AND pc.context_id = m.id
       AND pc.role_id = '${REPRESENTATIVE_ROLE_IDS.primaryContact}' AND pc.revoked_at IS NULL
     LEFT JOIN users u ON u.id = COALESCE(vd.user_id, pc.user_id)`,
  );

  const recipients: ForumVoteDelegateRecipient[] = [];
  for (const org of orgs) {
    const delegateId = org.delegate_user_id;
    if (!delegateId) continue;
    const user = org as typeof org & {
      delegate_email: string | null;
      delegate_first_name: string | null;
      delegate_last_name: string | null;
    };
    if (!user.delegate_email) continue;
    recipients.push({
      organizationId: org.id,
      organizationName: org.name,
      delegateUserId: delegateId,
      delegateEmail: user.delegate_email,
      delegateName:
        [user.delegate_first_name, user.delegate_last_name].filter(Boolean).join(" ") || user.delegate_email,
    });
  }

  return { vote: toVoteSummary(row), recipients };
}

export interface PendingForumVoteNotification extends ForumVoteDelegateRecipient {
  voteId: string;
  voteTitle: string;
  round: number;
  closesAt: string;
}

/**
 * Bounded, database-filtered delivery backlog. A delegate remains pending
 * until its outbox row and delivery marker commit in the same D1 batch.
 */
export async function listPendingForumVoteNotifications(
  db: DatabaseLike,
  limit: number,
): Promise<PendingForumVoteNotification[]> {
  const rows = await all<{
    vote_id: string;
    vote_title: string;
    round: number;
    closes_at: string;
    organization_id: string;
    organization_name: string;
    delegate_user_id: string;
    delegate_email: string;
    delegate_first_name: string | null;
    delegate_last_name: string | null;
  }>(
    db,
    `SELECT DISTINCT
       v.id AS vote_id, v.title AS vote_title, v.current_round AS round, v.closes_at,
       o.id AS organization_id, o.name AS organization_name,
       u.id AS delegate_user_id, u.email AS delegate_email,
       u.first_name AS delegate_first_name, u.last_name AS delegate_last_name
     FROM votes v
     JOIN organizations o
     JOIN members m ON m.organization_id = o.id AND m.status = 'active'
     LEFT JOIN user_roles vd ON vd.context_type = 'organization' AND vd.context_id = m.id
       AND vd.role_id = '${REPRESENTATIVE_ROLE_IDS.votingDelegate}' AND vd.revoked_at IS NULL
     LEFT JOIN user_roles pc ON pc.context_type = 'organization' AND pc.context_id = m.id
       AND pc.role_id = '${REPRESENTATIVE_ROLE_IDS.primaryContact}' AND pc.revoked_at IS NULL
     JOIN users u ON u.id = COALESCE(vd.user_id, pc.user_id)
     LEFT JOIN vote_notification_deliveries d
       ON d.vote_id = v.id AND d.round = v.current_round
      AND d.organization_id = o.id AND d.delegate_user_id = u.id
     WHERE v.scope_type = 'forum' AND v.status = 'open' AND d.vote_id IS NULL
     ORDER BY v.opens_at ASC, v.id ASC, o.id ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    voteId: row.vote_id,
    voteTitle: row.vote_title,
    round: row.round,
    closesAt: row.closes_at,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    delegateUserId: row.delegate_user_id,
    delegateEmail: row.delegate_email,
    delegateName: [row.delegate_first_name, row.delegate_last_name].filter(Boolean).join(" ") || row.delegate_email,
  }));
}

async function assertBallotChoiceValid(db: DatabaseLike, vote: VoteRow, choice: string): Promise<void> {
  if (vote.vote_type === "election") {
    const candidate = await first<{ id: string }>(
      db,
      `SELECT id FROM vote_candidates WHERE id = ? AND vote_id = ? AND eliminated_round IS NULL`,
      [choice, vote.id],
    );
    if (!candidate) throw new AppError(422, "INVALID_CHOICE", "choice must be a standing candidate id");
  } else if (!MOTION_CHOICES.has(choice as BallotChoice)) {
    throw new AppError(422, "INVALID_CHOICE", "choice must be one of in_favor, opposed, abstain");
  }
}

function assertEligibleCategory(vote: VoteRow, member: AuthMember): void {
  const restriction = eligibleCategoriesOf(vote);
  if (restriction && !restriction.includes(member.membershipCategory)) {
    throw new AppError(403, "CATEGORY_NOT_ELIGIBLE", "Your membership category is not eligible to vote in this vote");
  }
}

function assertVoteOpen(vote: VoteRow, now: string): void {
  if (vote.status !== "open" || vote.opens_at > now || vote.closes_at <= now) {
    throw new AppError(409, "VOTE_NOT_OPEN", "This vote is not currently open for ballots");
  }
}

function isBallotUniquenessError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: vote_ballots");
}

async function executeGuardedBallotInsert(statement: StatementLike): Promise<void> {
  try {
    const result = await statement.run();
    if (result.meta?.changes !== 1) {
      throw new AppError(409, "VOTE_CHANGED", "The vote round or voting window changed; reload and retry");
    }
  } catch (error) {
    if (isBallotUniquenessError(error)) {
      throw new AppError(409, "ALREADY_VOTED", "You have already cast a ballot for this round");
    }
    throw error;
  }
}

export async function submitBallot(
  db: DatabaseLike,
  member: AuthMember,
  voteIdOrSlug: string,
  choice: string,
  ipHash: string | null,
): Promise<void> {
  const vote = await getVoteRowOrThrow(db, voteIdOrSlug);
  const now = nowIso();
  assertVoteOpen(vote, now);
  await assertVotingCategory(member);
  assertEligibleCategory(vote, member);
  await assertBallotChoiceValid(db, vote, choice);

  if (vote.scope_type === "forum") {
    if (!member.organizationId) {
      throw new AppError(403, "NO_ORGANIZATION", "Only member organizations may cast a forum-level ballot");
    }
    const delegateId = await resolveVotingDelegateUserId(db, member.organizationId);
    if (delegateId !== member.userId) {
      throw new AppError(403, "NOT_VOTING_DELEGATE", "Only your organization's voting delegate may cast this ballot");
    }
    const existing = await first<{ id: string }>(
      db,
      `SELECT id FROM vote_ballots WHERE vote_id = ? AND organization_id = ? AND round = ?`,
      [vote.id, member.organizationId, vote.current_round],
    );
    if (existing)
      throw new AppError(409, "ALREADY_VOTED", "Your organization has already cast a ballot for this round");
    await executeGuardedBallotInsert(
      db
        .prepare(
          `INSERT INTO vote_ballots
             (id, vote_id, user_id, organization_id, choice, round, submitted_at, ip_hash)
           SELECT ?, v.id, ?, ?, ?, v.current_round, ?, ?
           FROM votes v
           WHERE v.id = ?
             AND v.status = 'open'
             AND v.current_round = ?
             AND v.transition_revision = ?
             AND v.transition_processing_token IS NULL
             AND v.opens_at <= ?
             AND v.closes_at > ?`,
        )
        .bind(
          uuid(),
          member.userId,
          member.organizationId,
          choice,
          now,
          ipHash,
          vote.id,
          vote.current_round,
          vote.transition_revision,
          now,
          now,
        ),
    );
    return;
  }

  // working_group scope: one ballot per person, must be an active WG member
  const membership = await first<{ id: string }>(
    db,
    `SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
    [vote.scope_id, member.userId],
  );
  if (!membership) {
    throw new AppError(403, "NOT_A_WG_MEMBER", "Only members of this working group may cast a ballot");
  }
  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM vote_ballots WHERE vote_id = ? AND user_id = ? AND round = ? AND organization_id IS NULL`,
    [vote.id, member.userId, vote.current_round],
  );
  if (existing) throw new AppError(409, "ALREADY_VOTED", "You have already cast a ballot for this round");
  await executeGuardedBallotInsert(
    db
      .prepare(
        `INSERT INTO vote_ballots
           (id, vote_id, user_id, organization_id, choice, round, submitted_at, ip_hash)
         SELECT ?, v.id, ?, NULL, ?, v.current_round, ?, ?
         FROM votes v
         WHERE v.id = ?
           AND v.status = 'open'
           AND v.current_round = ?
           AND v.transition_revision = ?
           AND v.transition_processing_token IS NULL
           AND v.opens_at <= ?
           AND v.closes_at > ?`,
      )
      .bind(
        uuid(),
        member.userId,
        choice,
        now,
        ipHash,
        vote.id,
        vote.current_round,
        vote.transition_revision,
        now,
        now,
      ),
  );
}
