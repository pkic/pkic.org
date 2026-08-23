/** Vote-proposal commands; read models and conversion planning live beside this file. */
import { first, run } from "../../db/queries";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { AppError } from "../../errors";
import type { AuthAdmin, AuthMember, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { stringifyJson } from "../../utils/json";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import {
  convertProposalToVote,
  convertProposalToVoteForMember,
  insertEndorsementAndMaybeConvert,
  isStaleProposalTransition,
  prepareProposalTransitionGuard,
} from "./proposal-conversion";
import { getProposalRowOrThrow, minEndorsersFor, toProposalSummary, type ProposalSummary } from "./proposal-read";
import { assertVotingCategory, resolveScope, type VoteScopeType, type VoteSummary, type VoteType } from "./shared";
import { ACTIVE_VOTER_MEMBERSHIP_SQL, activeVoterMembershipBindings } from "./voter-eligibility";

export {
  getProposalScopeForPermissionCheck,
  getVoteProposalDetail,
  listAllVoteProposalsForAdmin,
  listVoteProposals,
} from "./proposal-read";
export type { ProposalSummary, VoteProposalListParams } from "./proposal-read";

export interface SubmitProposalInput {
  title: string;
  description: string;
  voteType: VoteType;
  scopeType: VoteScopeType;
  scopeId?: string | null;
  eligibleCategories?: string[] | null;
  proposedOpensAt?: string | null;
  proposedClosesAt?: string | null;
}

export async function submitVoteProposal(
  db: DatabaseLike,
  member: AuthMember,
  input: SubmitProposalInput,
): Promise<ProposalSummary> {
  await assertVotingCategory(member);
  const scopeId = await resolveScope(db, input.scopeType, input.scopeId);
  if (input.scopeType === "working_group") {
    const membership = await first<{ id: string }>(
      db,
      "SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL",
      [scopeId, member.userId],
    );
    if (!membership) {
      throw new AppError(403, "NOT_A_WG_MEMBER", "Only members of this working group may propose a WG-level vote");
    }
  }
  if ((await minEndorsersFor(db, input.scopeType, scopeId)) <= 0) {
    throw new AppError(
      403,
      "ENDORSEMENT_PATH_DISABLED",
      "This scope requires direct staff or chair creation; member proposals are disabled.",
    );
  }

  const now = nowIso();
  const id = uuid();
  const inserted = await run(
    db,
    `INSERT INTO vote_proposals
       (id, title, description, vote_type, scope_type, scope_id, proposed_by_user_id, eligible_categories,
        proposed_opens_at, proposed_closes_at, status, vote_id, rejection_reason, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open_for_endorsement', NULL, NULL, ?, ?
     WHERE ${ACTIVE_VOTER_MEMBERSHIP_SQL}
       AND (
         ? <> 'working_group'
         OR EXISTS (
           SELECT 1
           FROM working_group_members wgm
           WHERE wgm.working_group_id = ? AND wgm.user_id = ? AND wgm.left_at IS NULL
         )
       )`,
    [
      id,
      input.title,
      input.description,
      input.voteType,
      input.scopeType,
      scopeId,
      member.userId,
      input.eligibleCategories ? stringifyJson(input.eligibleCategories) : null,
      input.proposedOpensAt ?? null,
      input.proposedClosesAt ?? null,
      now,
      now,
      ...activeVoterMembershipBindings(member),
      input.scopeType,
      scopeId,
      member.userId,
    ],
  );
  if (inserted.changes !== 1) {
    throw new AppError(409, "MEMBERSHIP_CHANGED", "Voting eligibility changed; reload and retry");
  }
  return toProposalSummary(db, await getProposalRowOrThrow(db, id));
}

export interface EndorseProposalResult {
  proposal: ProposalSummary;
  convertedVote: VoteSummary | null;
}

async function endorseVoteProposalOnce(
  db: DatabaseLike,
  member: AuthMember,
  proposalId: string,
): Promise<EndorseProposalResult> {
  await assertVotingCategory(member);
  const row = await getProposalRowOrThrow(db, proposalId);
  if (row.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_OPEN_FOR_ENDORSEMENT", "This proposal is not open for endorsement");
  }
  if (row.scope_type === "working_group") {
    const membership = await first<{ id: string }>(
      db,
      "SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL",
      [row.scope_id, member.userId],
    );
    if (!membership) throw new AppError(403, "NOT_A_WG_MEMBER", "Only members of this working group may endorse");
  }

  const existing = await first<{ id: string }>(
    db,
    "SELECT id FROM vote_proposal_endorsements WHERE proposal_id = ? AND endorser_user_id = ?",
    [proposalId, member.userId],
  );
  let convertedVote: VoteSummary | null = null;
  if (existing) {
    const refreshed = await toProposalSummary(db, row);
    if (refreshed.endorsementCount >= refreshed.minEndorsersRequired) {
      convertedVote = await convertProposalToVoteForMember(db, await getProposalRowOrThrow(db, proposalId), member);
    }
  } else {
    convertedVote = await insertEndorsementAndMaybeConvert(
      db,
      row,
      member,
      await minEndorsersFor(db, row.scope_type, row.scope_id),
    );
  }
  return {
    proposal: await toProposalSummary(db, await getProposalRowOrThrow(db, proposalId)),
    convertedVote,
  };
}

export async function endorseVoteProposal(
  db: DatabaseLike,
  member: AuthMember,
  proposalId: string,
): Promise<EndorseProposalResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await endorseVoteProposalOnce(db, member, proposalId);
    } catch (error) {
      if (!isStaleProposalTransition(error) || attempt === 2) throw error;
    }
  }
  throw new Error("Vote proposal endorsement could not be committed after concurrent changes");
}

async function withdrawEndorsementOnce(db: DatabaseLike, member: AuthMember, proposalId: string): Promise<void> {
  const proposal = await getProposalRowOrThrow(db, proposalId);
  if (proposal.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_OPEN_FOR_ENDORSEMENT", "Only an open proposal endorsement can be withdrawn");
  }
  const existing = await first<{ id: string }>(
    db,
    "SELECT id FROM vote_proposal_endorsements WHERE proposal_id = ? AND endorser_user_id = ?",
    [proposalId, member.userId],
  );
  if (!existing) return;
  const now = nowIso();
  await db.batch([
    prepareProposalTransitionGuard(db, proposal),
    db
      .prepare("DELETE FROM vote_proposal_endorsements WHERE proposal_id = ? AND endorser_user_id = ?")
      .bind(proposalId, member.userId),
    prepareAuditLog(
      db,
      "member",
      member.userId,
      "vote_proposal_endorsement_withdrawn",
      "vote_proposal",
      proposalId,
      {},
      now,
    ),
  ]);
}

export async function withdrawEndorsement(db: DatabaseLike, member: AuthMember, proposalId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await withdrawEndorsementOnce(db, member, proposalId);
    } catch (error) {
      if (!isStaleProposalTransition(error) || attempt === 2) throw error;
    }
  }
}

export async function withdrawVoteProposal(db: DatabaseLike, member: AuthMember, proposalId: string): Promise<void> {
  const row = await getProposalRowOrThrow(db, proposalId);
  if (row.proposed_by_user_id !== member.userId) {
    throw new AppError(403, "NOT_PROPOSER", "Only the proposer may withdraw this proposal");
  }
  if (row.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_WITHDRAWABLE", "Only an open proposal can be withdrawn");
  }
  try {
    await db.batch([
      prepareProposalTransitionGuard(db, row),
      db.prepare("UPDATE vote_proposals SET status = 'withdrawn', updated_at = ? WHERE id = ?").bind(nowIso(), row.id),
    ]);
  } catch (error) {
    if (!isStaleProposalTransition(error)) throw error;
    throw new AppError(409, "PROPOSAL_NOT_WITHDRAWABLE", "This proposal changed before it could be withdrawn");
  }
}

export interface ApproveProposalResult {
  proposal: ProposalSummary;
  convertedVote: VoteSummary;
}

export async function approveVoteProposal(
  db: DatabaseLike,
  admin: AuthAdmin,
  proposalId: string,
): Promise<ApproveProposalResult> {
  const row = await getProposalRowOrThrow(db, proposalId);
  if (row.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_OPEN_FOR_ENDORSEMENT", "This proposal is not open for endorsement");
  }
  return {
    convertedVote: await convertProposalToVote(db, row, admin.id),
    proposal: await toProposalSummary(db, await getProposalRowOrThrow(db, proposalId)),
  };
}

export interface RejectProposalResult {
  proposal: ProposalSummary;
  proposerUserId: string;
  proposerEmail: string;
  proposerName: string;
  outboxId: string | null;
}

export async function rejectVoteProposal(
  db: DatabaseLike,
  admin: AuthAdmin,
  proposalId: string,
  reason: string,
): Promise<RejectProposalResult> {
  const row = await getProposalRowOrThrow(db, proposalId);
  if (row.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_OPEN_FOR_ENDORSEMENT", "This proposal is not open for endorsement");
  }
  const proposer = await first<{ email: string; first_name: string | null; last_name: string | null }>(
    db,
    "SELECT email, first_name, last_name FROM users WHERE id = ?",
    [row.proposed_by_user_id],
  );
  const proposerEmail = proposer?.email ?? "";
  const proposerName = proposer
    ? [proposer.first_name, proposer.last_name].filter(Boolean).join(" ") || proposer.email
    : "";
  const now = nowIso();
  const statements: StatementLike[] = [
    prepareProposalTransitionGuard(db, row),
    db
      .prepare("UPDATE vote_proposals SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?")
      .bind(reason, now, row.id),
    prepareAuditLog(db, "admin", admin.id, "vote_proposal_rejected", "vote_proposal", row.id, { reason }, now),
  ];
  const queued = proposerEmail
    ? prepareQueueEmailStatement(
        db,
        {
          templateKey: "vote-proposal-rejected",
          recipientEmail: proposerEmail,
          recipientUserId: row.proposed_by_user_id,
          messageType: "transactional",
          subject: `Your vote proposal was not approved: ${row.title}`,
          data: { proposerName, proposalTitle: row.title, rejectionReason: reason },
        },
        now,
      )
    : null;
  if (queued) statements.push(queued.statement);
  try {
    await db.batch(statements);
  } catch (error) {
    if (!isStaleProposalTransition(error)) throw error;
    throw new AppError(409, "PROPOSAL_NOT_REJECTABLE", "This proposal changed before it could be rejected");
  }
  return {
    proposal: await toProposalSummary(db, await getProposalRowOrThrow(db, proposalId)),
    proposerUserId: row.proposed_by_user_id,
    proposerEmail,
    proposerName,
    outboxId: queued?.id ?? null,
  };
}
