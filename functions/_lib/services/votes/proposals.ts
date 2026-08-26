/** Vote-proposal commands; read models and conversion planning live beside this file. */
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first, run } from "../../db/queries";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { AppError } from "../../errors";
import type { AuthAdmin, AuthMember, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { stringifyJson } from "../../utils/json";
import { nowIso } from "../../utils/time";
import { prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import {
  prepareEffectiveGroupPermissionAuthorizationGuard,
  requireEffectiveGroupPermission,
} from "../groups/governance";
import {
  convertProposalToVote,
  convertProposalToVoteForMember,
  insertEndorsementAndMaybeConvert,
  isStaleProposalTransition,
  prepareProposalTransitionGuard,
} from "./proposal-conversion";
import { getProposalRowOrThrow, minEndorsersFor, toProposalSummary, type ProposalSummary } from "./proposal-read";
import { resolveVoteOwnerGroup, type VoteSummary, type VoteType } from "./shared";
import {
  ACTIVE_GROUP_VOTER_SQL,
  activeGroupVoterAuthorizationEvidence,
  activeGroupVoterBindings,
} from "./voter-eligibility";
import { requireSupportedVoteProposalType, validateVoteWindow } from "./configuration";

export {
  getProposalGroupForPermissionCheck,
  getVoteProposalDetail,
  getVoteProposalDetailForMember,
  listAllVoteProposalsForAdmin,
  listVoteProposals,
} from "./proposal-read";
export type { ProposalSummary, VoteProposalListParams } from "./proposal-read";

export interface SubmitProposalInput {
  title: string;
  description: string;
  voteType: VoteType;
  ownerGroupId: string;
  eligibleCategories?: string[] | null;
  proposedOpensAt?: string | null;
  proposedClosesAt?: string | null;
}

export async function submitVoteProposal(
  db: DatabaseLike,
  member: AuthMember,
  input: SubmitProposalInput,
): Promise<ProposalSummary> {
  requireSupportedVoteProposalType(input.voteType);
  if (input.proposedClosesAt) {
    validateVoteWindow(input.proposedOpensAt ?? nowIso(), input.proposedClosesAt);
  }
  const ownerGroupId = await resolveVoteOwnerGroup(db, input.ownerGroupId);
  const eligible = await first<{ authorized: number }>(
    db,
    `SELECT 1 AS authorized WHERE ${ACTIVE_GROUP_VOTER_SQL}`,
    activeGroupVoterBindings(member.userId, ownerGroupId),
  );
  if (!eligible) {
    throw new AppError(403, "NOT_AN_ELIGIBLE_GROUP_VOTER", "An active A-G capacity in the owning group is required");
  }
  if ((await minEndorsersFor(db, ownerGroupId)) <= 0) {
    throw new AppError(
      403,
      "ENDORSEMENT_PATH_DISABLED",
      "This group requires direct staff or leadership creation; member proposals are disabled.",
    );
  }

  const now = nowIso();
  const id = uuid();
  const inserted = await run(
    db,
    `INSERT INTO vote_proposals
       (id, title, description, vote_type, owner_group_id, proposed_by_user_id, eligible_categories,
        proposed_opens_at, proposed_closes_at, status, vote_id, rejection_reason, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open_for_endorsement', NULL, NULL, ?, ?
     WHERE ${ACTIVE_GROUP_VOTER_SQL}`,
    [
      id,
      input.title,
      input.description,
      input.voteType,
      ownerGroupId,
      member.userId,
      input.eligibleCategories ? stringifyJson(input.eligibleCategories) : null,
      input.proposedOpensAt ?? null,
      input.proposedClosesAt ?? null,
      now,
      now,
      ...activeGroupVoterBindings(member.userId, ownerGroupId),
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

function requireProposalGroup(row: { owner_group_id: string }, throughGroupId?: string): string {
  if (throughGroupId && row.owner_group_id !== throughGroupId) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Vote proposal not found through this group");
  }
  return throughGroupId ?? row.owner_group_id;
}

async function endorseVoteProposalOnce(
  db: DatabaseLike,
  member: AuthMember,
  proposalId: string,
  throughGroupId?: string,
): Promise<EndorseProposalResult> {
  const row = await getProposalRowOrThrow(db, proposalId);
  requireProposalGroup(row, throughGroupId);
  if (row.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_OPEN_FOR_ENDORSEMENT", "This proposal is not open for endorsement");
  }
  const eligible = await first<{ authorized: number }>(
    db,
    `SELECT 1 AS authorized WHERE ${ACTIVE_GROUP_VOTER_SQL}`,
    activeGroupVoterBindings(member.userId, row.owner_group_id),
  );
  if (!eligible) {
    throw new AppError(403, "NOT_AN_ELIGIBLE_GROUP_VOTER", "An active A-G capacity in the owning group is required");
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
      await minEndorsersFor(db, row.owner_group_id),
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
  throughGroupId?: string,
): Promise<EndorseProposalResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await endorseVoteProposalOnce(db, member, proposalId, throughGroupId);
    } catch (error) {
      if (!isStaleProposalTransition(error) || attempt === 2) throw error;
    }
  }
  throw new Error("Vote proposal endorsement could not be committed after concurrent changes");
}

async function withdrawEndorsementOnce(
  db: DatabaseLike,
  member: AuthMember,
  proposalId: string,
  throughGroupId?: string,
): Promise<void> {
  const proposal = await getProposalRowOrThrow(db, proposalId);
  requireProposalGroup(proposal, throughGroupId);
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
  try {
    await db.batch([
      prepareAuthorizationGuard(db, activeGroupVoterAuthorizationEvidence(member.userId, proposal.owner_group_id)),
      prepareProposalTransitionGuard(db, proposal),
      db
        .prepare("DELETE FROM vote_proposal_endorsements WHERE proposal_id = ? AND endorser_user_id = ?")
        .bind(proposalId, member.userId),
      prepareAuditLogAfterOneChange(
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
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "MEMBERSHIP_CHANGED", "Voting eligibility changed; reload and retry");
    }
    throw error;
  }
}

export async function withdrawEndorsement(
  db: DatabaseLike,
  member: AuthMember,
  proposalId: string,
  throughGroupId?: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await withdrawEndorsementOnce(db, member, proposalId, throughGroupId);
    } catch (error) {
      if (!isStaleProposalTransition(error) || attempt === 2) throw error;
    }
  }
}

export async function withdrawVoteProposal(
  db: DatabaseLike,
  member: AuthMember,
  proposalId: string,
  throughGroupId?: string,
): Promise<void> {
  const row = await getProposalRowOrThrow(db, proposalId);
  requireProposalGroup(row, throughGroupId);
  if (row.proposed_by_user_id !== member.userId) {
    throw new AppError(403, "NOT_PROPOSER", "Only the proposer may withdraw this proposal");
  }
  if (row.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_WITHDRAWABLE", "Only an open proposal can be withdrawn");
  }
  const now = nowIso();
  try {
    await db.batch([
      prepareAuthorizationGuard(db, activeGroupVoterAuthorizationEvidence(member.userId, row.owner_group_id)),
      prepareProposalTransitionGuard(db, row),
      db.prepare("UPDATE vote_proposals SET status = 'withdrawn', updated_at = ? WHERE id = ?").bind(now, row.id),
      prepareAuditLogAfterOneChange(
        db,
        "member",
        member.userId,
        "vote_proposal_withdrawn",
        "vote_proposal",
        row.id,
        { status: { from: row.status, to: "withdrawn" } },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "MEMBERSHIP_CHANGED", "Voting eligibility changed; reload and retry");
    }
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
  throughGroupId?: string,
): Promise<ApproveProposalResult> {
  const row = await getProposalRowOrThrow(db, proposalId);
  const authorizationGroupId = requireProposalGroup(row, throughGroupId);
  await requireEffectiveGroupPermission(db, admin, authorizationGroupId, "votes:manage");
  if (row.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_OPEN_FOR_ENDORSEMENT", "This proposal is not open for endorsement");
  }
  return {
    convertedVote: await convertProposalToVote(db, row, admin, authorizationGroupId),
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
  throughGroupId?: string,
): Promise<RejectProposalResult> {
  const row = await getProposalRowOrThrow(db, proposalId);
  const authorizationGroupId = requireProposalGroup(row, throughGroupId);
  await requireEffectiveGroupPermission(db, admin, authorizationGroupId, "votes:manage");
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
    prepareEffectiveGroupPermissionAuthorizationGuard(db, admin, [authorizationGroupId], "votes:manage"),
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
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "VOTE_MANAGEMENT_CHANGED", "Vote management permission changed before commit");
    }
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
