/**
 * Vote proposals (CA/Browser Forum endorsement model) and
 * their admin moderation ("staff admin / WG chair in context"). Split
 * out of votes.ts.
 */
import { all, first, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { stringifyJson } from "../../utils/json";
import { AppError } from "../../errors";
import { getMembershipSettings } from "../membership-settings";
import {
  resolveScope,
  uniqueSlug,
  toVoteSummary,
  getVoteRowOrThrow,
  assertVotingCategory,
  type VoteType,
  type VoteScopeType,
  type ThresholdType,
  type VoteStatus,
  type VoteProposalStatus,
  type VoteSummary,
} from "./shared";
import type { AuthMember, DatabaseLike } from "../../types";

interface ProposalRow {
  id: string;
  title: string;
  description: string;
  vote_type: VoteType;
  scope_type: VoteScopeType;
  scope_id: string | null;
  proposed_by_user_id: string;
  eligible_categories: string | null;
  proposed_opens_at: string | null;
  proposed_closes_at: string | null;
  status: VoteProposalStatus;
  vote_id: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalSummary {
  id: string;
  title: string;
  description: string;
  voteType: VoteType;
  scopeType: VoteScopeType;
  scopeId: string | null;
  proposedByUserId: string;
  status: VoteProposalStatus;
  voteId: string | null;
  rejectionReason: string | null;
  endorsementCount: number;
  minEndorsersRequired: number;
  createdAt: string;
}

async function minEndorsersFor(db: DatabaseLike, scopeType: VoteScopeType, scopeId: string | null): Promise<number> {
  if (scopeType === "forum") {
    const settings = await getMembershipSettings(db);
    return settings.forum_vote_min_endorsers;
  }
  const wg = await first<{ min_endorsers_for_ballot: number }>(
    db,
    `SELECT min_endorsers_for_ballot FROM working_groups WHERE id = ?`,
    [scopeId],
  );
  return wg?.min_endorsers_for_ballot ?? 0;
}

async function toProposalSummary(db: DatabaseLike, row: ProposalRow): Promise<ProposalSummary> {
  const countRow = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM vote_proposal_endorsements WHERE proposal_id = ?`,
    [row.id],
  );
  const minEndorsersRequired = await minEndorsersFor(db, row.scope_type, row.scope_id);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    voteType: row.vote_type,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    proposedByUserId: row.proposed_by_user_id,
    status: row.status,
    voteId: row.vote_id,
    rejectionReason: row.rejection_reason,
    endorsementCount: countRow?.n ?? 0,
    minEndorsersRequired,
    createdAt: row.created_at,
  };
}

async function getProposalRowOrThrow(db: DatabaseLike, id: string): Promise<ProposalRow> {
  const row = await first<ProposalRow>(db, `SELECT * FROM vote_proposals WHERE id = ?`, [id]);
  if (!row) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Vote proposal not found");
  return row;
}

/** Same purpose as getVoteScopeForPermissionCheck, for proposal approve/reject. */
export async function getProposalScopeForPermissionCheck(
  db: DatabaseLike,
  id: string,
): Promise<{ scopeType: VoteScopeType; scopeId: string | null }> {
  const row = await getProposalRowOrThrow(db, id);
  return { scopeType: row.scope_type, scopeId: row.scope_id };
}

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
      `SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
      [scopeId, member.userId],
    );
    if (!membership) {
      throw new AppError(403, "NOT_A_WG_MEMBER", "Only members of this working group may propose a WG-level vote");
    }
  }

  const minEndorsers = await minEndorsersFor(db, input.scopeType, scopeId);
  if (minEndorsers <= 0) {
    throw new AppError(
      403,
      "ENDORSEMENT_PATH_DISABLED",
      "This scope requires direct staff/chair creation — member proposals are disabled while min endorsers is 0",
    );
  }

  const now = nowIso();
  const id = uuid();
  await run(
    db,
    `INSERT INTO vote_proposals
       (id, title, description, vote_type, scope_type, scope_id, proposed_by_user_id, eligible_categories,
        proposed_opens_at, proposed_closes_at, status, vote_id, rejection_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open_for_endorsement', NULL, NULL, ?, ?)`,
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
    ],
  );

  return toProposalSummary(db, await getProposalRowOrThrow(db, id));
}

export async function listVoteProposals(
  db: DatabaseLike,
  params: { scopeType?: VoteScopeType; scopeId?: string; status?: VoteProposalStatus },
): Promise<ProposalSummary[]> {
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (params.scopeType) {
    conditions.push("scope_type = ?");
    args.push(params.scopeType);
  }
  if (params.scopeId) {
    conditions.push("scope_id = ?");
    args.push(params.scopeId);
  }
  conditions.push("status = ?");
  args.push(params.status ?? "open_for_endorsement");

  const rows = await all<ProposalRow>(
    db,
    `SELECT * FROM vote_proposals WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    args,
  );
  return Promise.all(rows.map((r) => toProposalSummary(db, r)));
}

export async function listAllVoteProposalsForAdmin(
  db: DatabaseLike,
  params: { status?: VoteProposalStatus },
): Promise<ProposalSummary[]> {
  if (!params.status) {
    const rows = await all<ProposalRow>(db, `SELECT * FROM vote_proposals ORDER BY created_at DESC`);
    return Promise.all(rows.map((r) => toProposalSummary(db, r)));
  }
  const rows = await all<ProposalRow>(db, `SELECT * FROM vote_proposals WHERE status = ? ORDER BY created_at DESC`, [
    params.status,
  ]);
  return Promise.all(rows.map((r) => toProposalSummary(db, r)));
}

export async function getVoteProposalDetail(
  db: DatabaseLike,
  proposalId: string,
): Promise<{ proposal: ProposalSummary; endorserUserIds: string[] }> {
  const row = await getProposalRowOrThrow(db, proposalId);
  const endorsers = await all<{ endorser_user_id: string }>(
    db,
    `SELECT endorser_user_id FROM vote_proposal_endorsements WHERE proposal_id = ? ORDER BY endorsed_at ASC`,
    [proposalId],
  );
  return { proposal: await toProposalSummary(db, row), endorserUserIds: endorsers.map((e) => e.endorser_user_id) };
}

async function convertProposalToVote(db: DatabaseLike, proposal: ProposalRow): Promise<VoteSummary> {
  const now = nowIso();
  const opensAt = proposal.proposed_opens_at ?? now;
  const closesAt = proposal.proposed_closes_at ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const thresholdType: ThresholdType = proposal.vote_type === "election" ? "successive_elimination" : "simple_majority";

  const id = uuid();
  const slug = await uniqueSlug(db, proposal.title);
  const status: VoteStatus = new Date(opensAt).getTime() <= Date.now() ? "open" : "scheduled";

  // Conversion is claimed and committed as one db.batch() (PR #1 review
  // §5.4): concurrent endorsement (last-endorser-triggers-conversion) and
  // admin approval both call this function, and both previously read the
  // proposal's status, decided to convert, then wrote in two separate,
  // unconditional statements — two concurrent callers could both insert a
  // vote for the same proposal, or a failed second write could orphan a
  // vote. Both statements below gate on the proposal's *own* current status
  // (open_for_endorsement) — not on the value they write, which every
  // racer would share and couldn't be used to tell winner from loser —
  // so only the caller that still finds it open_for_endorsement at this
  // batch's (fully serialized) execution time inserts anything.
  // votes.source_proposal_id UNIQUE (migration 0047) structurally backstops
  // this: it can't hold two votes even if this guard were ever bypassed.
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO votes
           (id, slug, title, description, vote_type, scope_type, scope_id, created_by_user_id, proposed_by_user_id,
            source_proposal_id, eligible_categories, threshold_type, opens_at, closes_at, current_round, status,
            result_json, visibility, public_detail_level, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, ?, NULL, 'private', 'aggregate', ?, ?
         FROM vote_proposals
         WHERE id = ? AND status = 'open_for_endorsement'`,
      )
      .bind(
        id,
        slug,
        proposal.title,
        proposal.description,
        proposal.vote_type,
        proposal.scope_type,
        proposal.scope_id,
        proposal.proposed_by_user_id,
        proposal.id,
        proposal.eligible_categories,
        thresholdType,
        opensAt,
        closesAt,
        status,
        now,
        now,
        proposal.id,
      ),
    db
      .prepare(
        `UPDATE vote_proposals SET status = 'converted_to_vote', vote_id = ?, updated_at = ?
         WHERE id = ? AND status = 'open_for_endorsement'`,
      )
      .bind(id, now, proposal.id),
  ]);

  const voteInserted = (results[0]?.meta?.changes ?? 0) > 0;
  if (!voteInserted) {
    // Lost the race — re-read and return the winner's vote rather than
    // creating a duplicate. If nothing converted it (rejected/withdrawn
    // concurrently instead), there is no vote to return.
    const current = await first<{ vote_id: string | null }>(db, `SELECT vote_id FROM vote_proposals WHERE id = ?`, [
      proposal.id,
    ]);
    if (current?.vote_id) {
      return toVoteSummary(await getVoteRowOrThrow(db, current.vote_id));
    }
    throw new AppError(409, "PROPOSAL_NOT_CONVERTIBLE", "This proposal is no longer open for endorsement");
  }

  return toVoteSummary(await getVoteRowOrThrow(db, id));
}

export interface EndorseProposalResult {
  proposal: ProposalSummary;
  convertedVote: VoteSummary | null;
}

export async function endorseVoteProposal(
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
      `SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
      [row.scope_id, member.userId],
    );
    if (!membership) throw new AppError(403, "NOT_A_WG_MEMBER", "Only members of this working group may endorse");
  }

  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM vote_proposal_endorsements WHERE proposal_id = ? AND endorser_user_id = ?`,
    [proposalId, member.userId],
  );
  if (!existing) {
    await run(
      db,
      `INSERT INTO vote_proposal_endorsements (id, proposal_id, endorser_user_id, endorsed_at) VALUES (?, ?, ?, ?)`,
      [uuid(), proposalId, member.userId, nowIso()],
    );
  }

  const refreshed = await toProposalSummary(db, await getProposalRowOrThrow(db, proposalId));

  if (refreshed.endorsementCount >= refreshed.minEndorsersRequired) {
    const convertedVote = await convertProposalToVote(db, await getProposalRowOrThrow(db, proposalId));
    const finalProposal = await toProposalSummary(db, await getProposalRowOrThrow(db, proposalId));
    return { proposal: finalProposal, convertedVote };
  }

  return { proposal: refreshed, convertedVote: null };
}

export async function withdrawEndorsement(db: DatabaseLike, member: AuthMember, proposalId: string): Promise<void> {
  await run(db, `DELETE FROM vote_proposal_endorsements WHERE proposal_id = ? AND endorser_user_id = ?`, [
    proposalId,
    member.userId,
  ]);
}

export async function withdrawVoteProposal(db: DatabaseLike, member: AuthMember, proposalId: string): Promise<void> {
  const row = await getProposalRowOrThrow(db, proposalId);
  if (row.proposed_by_user_id !== member.userId) {
    throw new AppError(403, "NOT_PROPOSER", "Only the proposer may withdraw this proposal");
  }
  if (row.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_WITHDRAWABLE", "Only an open proposal can be withdrawn");
  }
  await run(db, `UPDATE vote_proposals SET status = 'withdrawn', updated_at = ? WHERE id = ?`, [nowIso(), row.id]);
}

// ── Admin proposal moderation ("staff admin / WG chair in context") ───

export interface ApproveProposalResult {
  proposal: ProposalSummary;
  convertedVote: VoteSummary;
}

export async function approveVoteProposal(db: DatabaseLike, proposalId: string): Promise<ApproveProposalResult> {
  const row = await getProposalRowOrThrow(db, proposalId);
  if (row.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_OPEN_FOR_ENDORSEMENT", "This proposal is not open for endorsement");
  }
  const convertedVote = await convertProposalToVote(db, row);
  const proposal = await toProposalSummary(db, await getProposalRowOrThrow(db, proposalId));
  return { proposal, convertedVote };
}

export interface RejectProposalResult {
  proposal: ProposalSummary;
  proposerUserId: string;
  proposerEmail: string;
  proposerName: string;
}

export async function rejectVoteProposal(
  db: DatabaseLike,
  proposalId: string,
  reason: string,
): Promise<RejectProposalResult> {
  const row = await getProposalRowOrThrow(db, proposalId);
  if (row.status !== "open_for_endorsement") {
    throw new AppError(409, "NOT_OPEN_FOR_ENDORSEMENT", "This proposal is not open for endorsement");
  }
  await run(db, `UPDATE vote_proposals SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?`, [
    reason,
    nowIso(),
    row.id,
  ]);
  const proposal = await toProposalSummary(db, await getProposalRowOrThrow(db, proposalId));
  const proposer = await first<{ email: string; first_name: string | null; last_name: string | null }>(
    db,
    `SELECT email, first_name, last_name FROM users WHERE id = ?`,
    [row.proposed_by_user_id],
  );
  return {
    proposal,
    proposerUserId: row.proposed_by_user_id,
    proposerEmail: proposer?.email ?? "",
    proposerName: proposer ? [proposer.first_name, proposer.last_name].filter(Boolean).join(" ") || proposer.email : "",
  };
}
