/**
 * Vote proposals (CA/Browser Forum endorsement model) and
 * their admin moderation ("staff admin / WG chair in context"). Split
 * out of votes.ts.
 */
import { all, first, run } from "../../db/queries";
import { queryPage } from "../../db/pagination";
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
import type { AuthMember, DatabaseLike, StatementLike } from "../../types";

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

function toProposalSummaryFromRow(
  row: ProposalRow,
  endorsementCount: number,
  minEndorsersRequired: number,
): ProposalSummary {
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
    endorsementCount,
    minEndorsersRequired,
    createdAt: row.created_at,
  };
}

async function toProposalSummary(db: DatabaseLike, row: ProposalRow): Promise<ProposalSummary> {
  const countRow = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM vote_proposal_endorsements WHERE proposal_id = ?`,
    [row.id],
  );
  const minEndorsersRequired = await minEndorsersFor(db, row.scope_type, row.scope_id);
  return toProposalSummaryFromRow(row, countRow?.n ?? 0, minEndorsersRequired);
}

/** Bulk-loads endorsement counts for several proposals in one query instead of one query per proposal. */
async function loadEndorsementCounts(db: DatabaseLike, proposalIds: string[]): Promise<Map<string, number>> {
  if (proposalIds.length === 0) return new Map();
  const placeholders = proposalIds.map(() => "?").join(", ");
  const rows = await all<{ proposal_id: string; n: number }>(
    db,
    `SELECT proposal_id, COUNT(*) AS n FROM vote_proposal_endorsements
     WHERE proposal_id IN (${placeholders}) GROUP BY proposal_id`,
    proposalIds,
  );
  return new Map(rows.map((r) => [r.proposal_id, r.n]));
}

/**
 * Bulk-resolves minEndorsersRequired for several proposals in at most two
 * queries total (one membership-settings read shared by every forum-scoped
 * proposal, one bulk working_groups lookup for every WG-scoped proposal)
 * instead of one query per proposal.
 */
async function loadMinEndorsersByProposal(db: DatabaseLike, rows: ProposalRow[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const forumRows = rows.filter((r) => r.scope_type === "forum");
  const wgRows = rows.filter((r) => r.scope_type === "working_group" && r.scope_id);

  if (forumRows.length > 0) {
    const settings = await getMembershipSettings(db);
    for (const r of forumRows) result.set(r.id, settings.forum_vote_min_endorsers);
  }
  if (wgRows.length > 0) {
    const wgIds = [...new Set(wgRows.map((r) => r.scope_id as string))];
    const placeholders = wgIds.map(() => "?").join(", ");
    const workingGroups = await all<{ id: string; min_endorsers_for_ballot: number }>(
      db,
      `SELECT id, min_endorsers_for_ballot FROM working_groups WHERE id IN (${placeholders})`,
      wgIds,
    );
    const byWgId = new Map(workingGroups.map((w) => [w.id, w.min_endorsers_for_ballot]));
    for (const r of wgRows) result.set(r.id, byWgId.get(r.scope_id as string) ?? 0);
  }
  return result;
}

/** Bulk-builds proposal summaries for a page of rows with exactly two extra queries, regardless of page size. */
async function toProposalSummaries(db: DatabaseLike, rows: ProposalRow[]): Promise<ProposalSummary[]> {
  if (rows.length === 0) return [];
  const proposalIds = rows.map((r) => r.id);
  const [endorsementCounts, minEndorsersByProposal] = await Promise.all([
    loadEndorsementCounts(db, proposalIds),
    loadMinEndorsersByProposal(db, rows),
  ]);
  return rows.map((row) =>
    toProposalSummaryFromRow(row, endorsementCounts.get(row.id) ?? 0, minEndorsersByProposal.get(row.id) ?? 0),
  );
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
  params: {
    scopeType?: VoteScopeType;
    scopeId?: string;
    status?: VoteProposalStatus;
    limit: number;
    offset: number;
  },
): Promise<{ proposals: ProposalSummary[]; total: number }> {
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
  const where = conditions.join(" AND ");

  const { rows, total } = await queryPage<ProposalRow>(
    db,
    {
      sql: `SELECT * FROM vote_proposals WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      bindings: [...args, params.limit, params.offset],
    },
    { sql: `SELECT COUNT(*) AS total FROM vote_proposals WHERE ${where}`, bindings: args },
  );

  return { proposals: await toProposalSummaries(db, rows), total };
}

export async function listAllVoteProposalsForAdmin(
  db: DatabaseLike,
  params: { status?: VoteProposalStatus; limit: number; offset: number },
): Promise<{ proposals: ProposalSummary[]; total: number }> {
  const where = params.status ? "WHERE status = ?" : "";
  const whereArgs = params.status ? [params.status] : [];

  const { rows, total } = await queryPage<ProposalRow>(
    db,
    {
      sql: `SELECT * FROM vote_proposals ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      bindings: [...whereArgs, params.limit, params.offset],
    },
    { sql: `SELECT COUNT(*) AS total FROM vote_proposals ${where}`, bindings: whereArgs },
  );

  return { proposals: await toProposalSummaries(db, rows), total };
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

interface ConversionFields {
  id: string;
  slug: string;
  now: string;
  opensAt: string;
  closesAt: string;
  thresholdType: ThresholdType;
  status: VoteStatus;
}

async function buildConversionFields(db: DatabaseLike, proposal: ProposalRow): Promise<ConversionFields> {
  const now = nowIso();
  const opensAt = proposal.proposed_opens_at ?? now;
  const closesAt = proposal.proposed_closes_at ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const thresholdType: ThresholdType = proposal.vote_type === "election" ? "successive_elimination" : "simple_majority";
  const id = uuid();
  const slug = await uniqueSlug(db, proposal.title);
  const status: VoteStatus = new Date(opensAt).getTime() <= Date.now() ? "open" : "scheduled";
  return { id, slug, now, opensAt, closesAt, thresholdType, status };
}

/**
 * Builds (does not execute) the vote-insert + proposal-status-update
 * statement pair that atomically converts a proposal to a vote (PR #1
 * review §5.4). Both statements gate on the proposal's *own* current status
 * (open_for_endorsement) — not on the value they write, which every racer
 * would share and couldn't be used to tell winner from loser — so only the
 * caller that still finds it open_for_endorsement at this batch's (fully
 * serialized) execution time inserts anything. votes.source_proposal_id
 * UNIQUE (migration 0047) structurally backstops this: it can't hold two
 * votes even if this guard were ever bypassed.
 *
 * `extraGuard`, when given, is ANDed into both WHERE clauses. The
 * endorsement path (PR #1 review §5-R01) uses this to additionally require
 * the endorsement count — read via a subquery evaluated inside the same
 * transaction as the endorsement insert that precedes these two statements
 * in its batch — to have reached the threshold, so the insert and any
 * conversion it triggers commit or fail together as one atomic unit.
 */
function buildConversionStatements(
  db: DatabaseLike,
  proposal: ProposalRow,
  fields: ConversionFields,
  extraGuard?: { sql: string; args: unknown[] },
): [StatementLike, StatementLike] {
  const guardSql = extraGuard ? ` AND ${extraGuard.sql}` : "";
  const guardArgs = extraGuard?.args ?? [];
  const voteInsert = db
    .prepare(
      `INSERT INTO votes
         (id, slug, title, description, vote_type, scope_type, scope_id, created_by_user_id, proposed_by_user_id,
          source_proposal_id, eligible_categories, threshold_type, opens_at, closes_at, current_round, status,
          result_json, visibility, public_detail_level, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, ?, NULL, 'private', 'aggregate', ?, ?
       FROM vote_proposals
       WHERE id = ? AND status = 'open_for_endorsement'${guardSql}`,
    )
    .bind(
      fields.id,
      fields.slug,
      proposal.title,
      proposal.description,
      proposal.vote_type,
      proposal.scope_type,
      proposal.scope_id,
      proposal.proposed_by_user_id,
      proposal.id,
      proposal.eligible_categories,
      fields.thresholdType,
      fields.opensAt,
      fields.closesAt,
      fields.status,
      fields.now,
      fields.now,
      proposal.id,
      ...guardArgs,
    );
  const updateStatus = db
    .prepare(
      `UPDATE vote_proposals SET status = 'converted_to_vote', vote_id = ?, updated_at = ?
       WHERE id = ? AND status = 'open_for_endorsement'${guardSql}`,
    )
    .bind(fields.id, fields.now, proposal.id, ...guardArgs);
  return [voteInsert, updateStatus];
}

/**
 * Lost-race fallback shared by convertProposalToVote and
 * insertEndorsementAndMaybeConvert: when a guarded conversion attempt
 * affects 0 rows, some other caller (a concurrent admin approval, or
 * another endorser's own atomic attempt) may have already converted the
 * proposal first. Re-reads and returns that winner's vote instead of
 * treating the no-op as an error; returns null if nothing converted it at
 * all (e.g. rejected/withdrawn concurrently instead).
 *
 * PR #1 review §5-R02: this re-read is itself a narrow, infra-failure-only
 * double-fault risk — if it throws (e.g. a transient D1 error immediately
 * following the batch whose 0-row result triggered this call), a bare
 * rethrow would surface only "the re-read failed," losing the fact that
 * the actual event under investigation was a *lost race on proposal
 * `proposalId`'s conversion*, not a re-read-unrelated failure. Wrapping
 * preserves both: the caller (and logs) see the original re-read error's
 * message/stack via `cause`, plus the proposal-scoped context needed to
 * know a conversion outcome is now unconfirmed rather than assume it
 * simply didn't happen.
 */
async function resolveLostRaceVote(db: DatabaseLike, proposalId: string): Promise<VoteSummary | null> {
  try {
    const current = await first<{ vote_id: string | null }>(db, `SELECT vote_id FROM vote_proposals WHERE id = ?`, [
      proposalId,
    ]);
    return current?.vote_id ? toVoteSummary(await getVoteRowOrThrow(db, current.vote_id)) : null;
  } catch (error) {
    throw new AppError(
      500,
      "VOTE_CONVERSION_STATUS_UNKNOWN",
      "A vote-proposal conversion attempt completed without inserting a vote, and the follow-up read to " +
        "determine whether a concurrent caller won the race also failed — this proposal's conversion status " +
        "could not be confirmed.",
      { proposalId, cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function convertProposalToVote(db: DatabaseLike, proposal: ProposalRow): Promise<VoteSummary> {
  const fields = await buildConversionFields(db, proposal);
  const [voteInsert, updateStatus] = buildConversionStatements(db, proposal, fields);
  const results = await db.batch([voteInsert, updateStatus]);

  const voteInserted = (results[0]?.meta?.changes ?? 0) > 0;
  if (!voteInserted) {
    const convertedVote = await resolveLostRaceVote(db, proposal.id);
    if (convertedVote) return convertedVote;
    throw new AppError(409, "PROPOSAL_NOT_CONVERTIBLE", "This proposal is no longer open for endorsement");
  }

  return toVoteSummary(await getVoteRowOrThrow(db, fields.id));
}

/**
 * Endorsement path only (PR #1 review §5-R01): inserts the endorser's row
 * and attempts the guarded proposal-to-vote conversion in the SAME
 * db.batch() so the two either both commit or both fail together — unlike
 * the pre-fix code, which committed the endorsement insert as its own
 * statement and only afterward, in a separate step, decided whether to
 * convert.
 *
 * The conversion's extra guard checks `COUNT(*) >= minEndorsersRequired`
 * via a subquery evaluated inside this same transaction, after the
 * endorsement insert immediately above it in the batch has already applied
 * — not a pre-insert count read in application code. A pre-insert JS-level
 * count would be stale under genuine concurrency: two endorsers reading the
 * count before either commits could each compute a predicted total under
 * the threshold and neither would attempt conversion, even though the
 * threshold is reached once both inserts land. Gating in SQL against the
 * transaction's own post-insert state avoids that missed-conversion race
 * the same way the existing open_for_endorsement status guard already does
 * for concurrent conversion attempts (see buildConversionStatements). The
 * conversion statements always run (as a no-op when the guard fails)
 * rather than being conditionally included in the batch, since D1 batch
 * statements can't branch on an earlier statement's result within the same
 * call — this mirrors convertProposalToVote's own unconditional-statements
 * pattern, just extended with one more guard clause.
 */
async function insertEndorsementAndMaybeConvert(
  db: DatabaseLike,
  proposal: ProposalRow,
  endorserUserId: string,
  minEndorsersRequired: number,
): Promise<VoteSummary | null> {
  const endorsementInsert = db
    .prepare(
      `INSERT INTO vote_proposal_endorsements (id, proposal_id, endorser_user_id, endorsed_at) VALUES (?, ?, ?, ?)`,
    )
    .bind(uuid(), proposal.id, endorserUserId, nowIso());

  const fields = await buildConversionFields(db, proposal);
  const [voteInsert, updateStatus] = buildConversionStatements(db, proposal, fields, {
    sql: `(SELECT COUNT(*) FROM vote_proposal_endorsements WHERE proposal_id = ?) >= ?`,
    args: [proposal.id, minEndorsersRequired],
  });

  const results = await db.batch([endorsementInsert, voteInsert, updateStatus]);

  const voteInserted = (results[1]?.meta?.changes ?? 0) > 0;
  if (voteInserted) {
    return toVoteSummary(await getVoteRowOrThrow(db, fields.id));
  }
  // Below threshold (the common case), or converted/rejected/withdrawn by a
  // concurrent caller before this batch's guarded statements ran.
  return resolveLostRaceVote(db, proposal.id);
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

  let convertedVote: VoteSummary | null = null;
  if (existing) {
    // Already endorsed by this member: nothing to insert, so there is no
    // endorsement write to fold into an atomic batch with a conversion
    // (PR #1 review §5-R01 targets that pairing specifically). Still
    // re-check the threshold in case it dropped below the current
    // endorsement count since this member's earlier endorsement (e.g. an
    // admin lowered min_endorsers for this scope in the meantime).
    const refreshed = await toProposalSummary(db, row);
    if (refreshed.endorsementCount >= refreshed.minEndorsersRequired) {
      convertedVote = await convertProposalToVote(db, await getProposalRowOrThrow(db, proposalId));
    }
  } else {
    const minEndorsersRequired = await minEndorsersFor(db, row.scope_type, row.scope_id);
    convertedVote = await insertEndorsementAndMaybeConvert(db, row, member.userId, minEndorsersRequired);
  }

  const finalProposal = await toProposalSummary(db, await getProposalRowOrThrow(db, proposalId));
  return { proposal: finalProposal, convertedVote };
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
