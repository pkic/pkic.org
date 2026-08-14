/**
 * Ballot eligibility and submission. Split out of votes.ts.
 */
import { all, first, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
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
import type { AuthMember, DatabaseLike } from "../../types";

interface OrgDelegateRow {
  id: string;
  primary_contact_user_id: string | null;
  voting_delegate_user_id: string | null;
}

/** organizations.voting_delegate_user_id NULL falls back to primary_contact_user_id. */
export async function resolveVotingDelegateUserId(db: DatabaseLike, organizationId: string): Promise<string | null> {
  const org = await first<OrgDelegateRow>(
    db,
    `SELECT id, primary_contact_user_id, voting_delegate_user_id FROM organizations WHERE id = ?`,
    [organizationId],
  );
  if (!org) return null;
  return org.voting_delegate_user_id ?? org.primary_contact_user_id;
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

  const orgs = await all<{
    id: string;
    name: string;
    primary_contact_user_id: string | null;
    voting_delegate_user_id: string | null;
  }>(
    db,
    `SELECT DISTINCT o.id, o.name, o.primary_contact_user_id, o.voting_delegate_user_id
     FROM organizations o JOIN members m ON m.organization_id = o.id
     WHERE m.status = 'active'`,
  );

  const recipients: ForumVoteDelegateRecipient[] = [];
  for (const org of orgs) {
    const delegateId = org.voting_delegate_user_id ?? org.primary_contact_user_id;
    if (!delegateId) continue;
    const user = await first<{ email: string; first_name: string | null; last_name: string | null }>(
      db,
      `SELECT email, first_name, last_name FROM users WHERE id = ?`,
      [delegateId],
    );
    if (!user) continue;
    recipients.push({
      organizationId: org.id,
      organizationName: org.name,
      delegateUserId: delegateId,
      delegateEmail: user.email,
      delegateName: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email,
    });
  }

  return { vote: toVoteSummary(row), recipients };
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

function assertVoteOpen(vote: VoteRow): void {
  if (vote.status !== "open") {
    throw new AppError(409, "VOTE_NOT_OPEN", "This vote is not currently open for ballots");
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
  assertVoteOpen(vote);
  await assertVotingCategory(member);
  assertEligibleCategory(vote, member);
  await assertBallotChoiceValid(db, vote, choice);

  const now = nowIso();

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
    await run(
      db,
      `INSERT INTO vote_ballots (id, vote_id, user_id, organization_id, choice, round, submitted_at, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), vote.id, member.userId, member.organizationId, choice, vote.current_round, now, ipHash],
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
  await run(
    db,
    `INSERT INTO vote_ballots (id, vote_id, user_id, organization_id, choice, round, submitted_at, ip_hash)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
    [uuid(), vote.id, member.userId, choice, vote.current_round, now, ipHash],
  );
}
