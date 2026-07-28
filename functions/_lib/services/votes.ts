/**
 * Voting system (PRD §4.8, Phase 4B). Two vote-creation paths (direct
 * staff/chair creation, and member proposal + endorsement conversion),
 * forum-level (one ballot per organization, cast by its voting delegate)
 * and working-group-level (one ballot per person) eligibility, three
 * threshold types, and configurable per-vote result visibility.
 *
 * Does not call queueEmail directly — same DB-only/route-owns-email split
 * every other service in this codebase uses (see membership-onboarding.ts's
 * header note).
 *
 * **Successive-elimination rounds.** §4.8 describes a live, multi-round
 * process ("after each round, the candidate with fewest votes is
 * eliminated... continues until one candidate holds >50%"), but nothing in
 * the PRD specifies how a new round's voting window is scheduled. This
 * implementation automates it: `closeDueVotes` (called by the scheduled-jobs
 * pass, mirroring membership-scheduled-jobs.ts's own pattern) computes the
 * closing round's tally, and if no candidate has a majority, eliminates the
 * lowest-scoring candidate(s) (both, if tied for last — per §4.8's tie
 * rule), increments `current_round`, and reopens voting for the same
 * duration as the original round (closes_at - opens_at). Voters must recast
 * for the new round; `vote_ballots.round` scopes each round's ballots
 * independently. The one case §4.8 doesn't cover: if literally every
 * remaining candidate is tied (eliminating "the fewest" would eliminate
 * everyone), nobody is eliminated and the same round re-runs unchanged —
 * a deliberate reading beyond the letter of the tie rule, needed to avoid
 * a zero-candidate result.
 */
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import { AppError } from "../errors";
import { VOTING_CATEGORIES } from "./member-applications";
import { getWorkingGroupBySlugOrId } from "./working-groups";
import { getMembershipSettings } from "./membership-settings";
import type { AuthAdmin, AuthMember, DatabaseLike } from "../types";

export type VoteType = "election" | "motion" | "consultation";
export type VoteScopeType = "forum" | "working_group";
export type ThresholdType = "simple_majority" | "supermajority" | "successive_elimination";
export type VoteStatus = "scheduled" | "open" | "closed" | "cancelled";
export type VoteVisibility = "private" | "public";
export type PublicDetailLevel = "outcome_only" | "aggregate" | "full_breakdown";
export type BallotChoice = "in_favor" | "opposed" | "abstain";

const MOTION_CHOICES = new Set<BallotChoice>(["in_favor", "opposed", "abstain"]);

interface VoteRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  vote_type: VoteType;
  scope_type: VoteScopeType;
  scope_id: string | null;
  created_by_user_id: string | null;
  proposed_by_user_id: string | null;
  eligible_categories: string | null;
  threshold_type: ThresholdType;
  opens_at: string;
  closes_at: string;
  current_round: number;
  status: VoteStatus;
  result_json: string | null;
  visibility: VoteVisibility;
  public_detail_level: PublicDetailLevel;
  created_at: string;
  updated_at: string;
}

interface CandidateRow {
  id: string;
  vote_id: string;
  user_id: string | null;
  candidate_name: string;
  candidate_bio: string | null;
  nominated_by_user_id: string | null;
  sort_order: number;
  eliminated_round: number | null;
  created_at: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function uniqueSlug(db: DatabaseLike, title: string): Promise<string> {
  const base = slugify(title) || "vote";
  let candidate = base;
  let suffix = 2;
  // Bounded by the number of collisions actually found — no realistic vote
  // titling scheme produces more than a handful.
  while (await first<{ id: string }>(db, `SELECT id FROM votes WHERE slug = ?`, [candidate])) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function eligibleCategoriesOf(row: VoteRow): string[] | null {
  const parsed = parseJsonSafe<string[] | null>(row.eligible_categories, null);
  return parsed;
}

export interface CandidateSummary {
  id: string;
  userId: string | null;
  candidateName: string;
  candidateBio: string | null;
  sortOrder: number;
  eliminatedRound: number | null;
}

function toCandidateSummary(row: CandidateRow): CandidateSummary {
  return {
    id: row.id,
    userId: row.user_id,
    candidateName: row.candidate_name,
    candidateBio: row.candidate_bio,
    sortOrder: row.sort_order,
    eliminatedRound: row.eliminated_round,
  };
}

export interface VoteSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  voteType: VoteType;
  scopeType: VoteScopeType;
  scopeId: string | null;
  thresholdType: ThresholdType;
  eligibleCategories: string[] | null;
  opensAt: string;
  closesAt: string;
  currentRound: number;
  status: VoteStatus;
  visibility: VoteVisibility;
  publicDetailLevel: PublicDetailLevel;
  createdAt: string;
  updatedAt: string;
}

function toVoteSummary(row: VoteRow): VoteSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    voteType: row.vote_type,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    thresholdType: row.threshold_type,
    eligibleCategories: eligibleCategoriesOf(row),
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    currentRound: row.current_round,
    status: row.status,
    visibility: row.visibility,
    publicDetailLevel: row.public_detail_level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getCandidates(db: DatabaseLike, voteId: string): Promise<CandidateSummary[]> {
  const rows = await all<CandidateRow>(
    db,
    `SELECT * FROM vote_candidates WHERE vote_id = ? ORDER BY sort_order ASC, created_at ASC`,
    [voteId],
  );
  return rows.map(toCandidateSummary);
}

async function getVoteRowOrThrow(db: DatabaseLike, idOrSlug: string): Promise<VoteRow> {
  const row = await first<VoteRow>(db, `SELECT * FROM votes WHERE id = ? OR slug = ?`, [idOrSlug, idOrSlug]);
  if (!row) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  return row;
}

/**
 * Just enough to build a votes:manage permission context (WG-scoped vs
 * global) before mutating — admin route handlers call this first so a WG
 * chair's scoped grant is checked against the vote's actual working group.
 */
export async function getVoteScopeForPermissionCheck(
  db: DatabaseLike,
  idOrSlug: string,
): Promise<{ scopeType: VoteScopeType; scopeId: string | null }> {
  const row = await getVoteRowOrThrow(db, idOrSlug);
  return { scopeType: row.scope_type, scopeId: row.scope_id };
}

// ── Result computation (§4.8 threshold types) ─────────────────────────────

export interface MotionResult {
  thresholdType: "simple_majority" | "supermajority";
  counts: Record<BallotChoice, number>;
  totalBallots: number;
  outcome: "passed" | "failed";
}

function computeMotionResult(
  thresholdType: "simple_majority" | "supermajority",
  ballots: { choice: string }[],
): MotionResult {
  const counts: Record<BallotChoice, number> = { in_favor: 0, opposed: 0, abstain: 0 };
  for (const b of ballots) {
    if (b.choice in counts) counts[b.choice as BallotChoice] += 1;
  }
  const decisive = counts.in_favor + counts.opposed;
  // Integer cross-multiplication avoids floating-point edge cases at
  // exactly 2/3. §10: simple majority is ">50% of ballots cast" (strict);
  // supermajority is "≥⅔ of ballots cast" (inclusive) — the two thresholds
  // deliberately use different comparison operators, not just different
  // fractions. "Ballots cast" is read as decisive ballots (in_favor +
  // opposed) — abstentions affect neither side, the standard parliamentary
  // convention and the only reading consistent with §10's "no quorum
  // requirement... binding based on members who cast a vote" language.
  const passed =
    decisive > 0 &&
    (thresholdType === "supermajority" ? counts.in_favor * 3 >= decisive * 2 : counts.in_favor * 2 > decisive);
  const outcome: "passed" | "failed" = passed ? "passed" : "failed";
  return { thresholdType, counts, totalBallots: ballots.length, outcome };
}

export interface ElectionRoundTally {
  round: number;
  counts: Record<string, number>;
  eliminatedCandidateIds: string[];
  winnerCandidateId: string | null;
}

/**
 * Tallies one round of an election. Returns the winner (>50% of that
 * round's ballots) or the candidate id(s) to eliminate for the next round.
 * When every standing candidate is tied, nobody is eliminated (see this
 * file's header) — the caller re-runs the same round.
 */
function tallyElectionRound(
  round: number,
  standingCandidateIds: string[],
  ballots: { choice: string }[],
): ElectionRoundTally {
  const counts: Record<string, number> = Object.fromEntries(standingCandidateIds.map((id) => [id, 0]));
  for (const b of ballots) {
    if (b.choice in counts) counts[b.choice] += 1;
  }
  const total = ballots.length;

  if (standingCandidateIds.length === 1) {
    return { round, counts, eliminatedCandidateIds: [], winnerCandidateId: standingCandidateIds[0] };
  }

  const winner = standingCandidateIds.find((id) => total > 0 && counts[id] / total > 0.5) ?? null;
  if (winner) {
    return { round, counts, eliminatedCandidateIds: [], winnerCandidateId: winner };
  }

  const lowest = Math.min(...standingCandidateIds.map((id) => counts[id]));
  const lowestIds = standingCandidateIds.filter((id) => counts[id] === lowest);
  const eliminatedCandidateIds = lowestIds.length === standingCandidateIds.length ? [] : lowestIds;
  return { round, counts, eliminatedCandidateIds, winnerCandidateId: null };
}

// ── Direct vote creation (§4.8 Path A — staff admin or WG chair) ─────────

export interface CreateVoteInput {
  title: string;
  description?: string;
  voteType: VoteType;
  scopeType: VoteScopeType;
  scopeId?: string | null;
  thresholdType: ThresholdType;
  eligibleCategories?: string[] | null;
  opensAt?: string;
  closesAt: string;
  candidates?: { name: string; bio?: string; userId?: string | null }[];
}

async function resolveScope(
  db: DatabaseLike,
  scopeType: VoteScopeType,
  scopeId?: string | null,
): Promise<string | null> {
  if (scopeType === "forum") return null;
  if (!scopeId) throw new AppError(422, "SCOPE_ID_REQUIRED", "scopeId is required for working_group-scoped votes");
  const wg = await getWorkingGroupBySlugOrId(db, scopeId);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  return wg.id;
}

function validateThresholdForType(voteType: VoteType, thresholdType: ThresholdType, candidateCount: number): void {
  if (voteType === "election") {
    if (thresholdType === "successive_elimination" && candidateCount < 3) {
      throw new AppError(
        422,
        "INVALID_THRESHOLD",
        "successive_elimination requires at least 3 candidates; use simple_majority for 2-candidate elections",
      );
    }
    if (thresholdType === "supermajority") {
      throw new AppError(422, "INVALID_THRESHOLD", "supermajority does not apply to elections");
    }
  } else if (thresholdType === "successive_elimination") {
    throw new AppError(422, "INVALID_THRESHOLD", "successive_elimination only applies to elections");
  }
}

export async function createVoteDirect(
  db: DatabaseLike,
  admin: AuthAdmin,
  input: CreateVoteInput,
): Promise<VoteSummary> {
  const scopeId = await resolveScope(db, input.scopeType, input.scopeId);
  const candidates = input.voteType === "election" ? (input.candidates ?? []) : [];
  if (input.voteType === "election" && candidates.length < 2) {
    throw new AppError(422, "CANDIDATES_REQUIRED", "Election votes require at least 2 candidates");
  }
  validateThresholdForType(input.voteType, input.thresholdType, candidates.length);

  const now = nowIso();
  const opensAt = input.opensAt ?? now;
  if (new Date(input.closesAt).getTime() <= new Date(opensAt).getTime()) {
    throw new AppError(422, "INVALID_WINDOW", "closesAt must be after opensAt");
  }

  const id = uuid();
  const slug = await uniqueSlug(db, input.title);
  const status: VoteStatus = new Date(opensAt).getTime() <= Date.now() ? "open" : "scheduled";

  await run(
    db,
    `INSERT INTO votes
       (id, slug, title, description, vote_type, scope_type, scope_id, created_by_user_id, proposed_by_user_id,
        eligible_categories, threshold_type, opens_at, closes_at, current_round, status, result_json,
        visibility, public_detail_level, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, NULL, 'private', 'aggregate', ?, ?)`,
    [
      id,
      slug,
      input.title,
      input.description ?? null,
      input.voteType,
      input.scopeType,
      scopeId,
      admin.id,
      input.eligibleCategories ? stringifyJson(input.eligibleCategories) : null,
      input.thresholdType,
      opensAt,
      input.closesAt,
      status,
      now,
      now,
    ],
  );

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    await run(
      db,
      `INSERT INTO vote_candidates (id, vote_id, user_id, candidate_name, candidate_bio, nominated_by_user_id, sort_order, eliminated_round, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [uuid(), id, c.userId ?? null, c.name, c.bio ?? null, admin.id, i, now],
    );
  }

  return toVoteSummary(await getVoteRowOrThrow(db, id));
}

export interface UpdateVoteInput {
  title?: string;
  description?: string | null;
  opensAt?: string;
  closesAt?: string;
}

export async function updateVoteSettings(
  db: DatabaseLike,
  voteId: string,
  input: UpdateVoteInput,
): Promise<VoteSummary> {
  const existing = await getVoteRowOrThrow(db, voteId);
  if (existing.status === "closed") {
    throw new AppError(409, "VOTE_CLOSED", "Cannot update a closed vote");
  }
  const now = nowIso();
  await run(
    db,
    `UPDATE votes SET title = COALESCE(?, title), description = COALESCE(?, description),
       opens_at = COALESCE(?, opens_at), closes_at = COALESCE(?, closes_at), updated_at = ? WHERE id = ?`,
    [input.title ?? null, input.description ?? null, input.opensAt ?? null, input.closesAt ?? null, now, existing.id],
  );
  return toVoteSummary(await getVoteRowOrThrow(db, existing.id));
}

export async function updateVoteVisibility(
  db: DatabaseLike,
  voteId: string,
  input: { visibility?: VoteVisibility; publicDetailLevel?: PublicDetailLevel },
): Promise<VoteSummary> {
  const existing = await getVoteRowOrThrow(db, voteId);
  const now = nowIso();
  await run(
    db,
    `UPDATE votes SET visibility = COALESCE(?, visibility), public_detail_level = COALESCE(?, public_detail_level), updated_at = ? WHERE id = ?`,
    [input.visibility ?? null, input.publicDetailLevel ?? null, now, existing.id],
  );
  return toVoteSummary(await getVoteRowOrThrow(db, existing.id));
}

// ── Admin: list all votes ─────────────────────────────────────────────
//
// Not in §7's endpoint table (which only lists POST/PATCH by id for the
// admin votes surface) — added because the admin UI has nothing else to
// list votes from; staff aren't necessarily also portal members, so the
// member-only GET /api/v1/portal/votes can't stand in. Same "necessary
// addition beyond the PRD's literal table" precedent as Phase 1's extra
// sponsorship columns (see migration 0034's header).

export interface AdminVoteSummary extends VoteSummary {
  candidates: CandidateSummary[] | null;
}

export async function listVotesForAdmin(
  db: DatabaseLike,
  params: { status?: VoteStatus } = {},
): Promise<AdminVoteSummary[]> {
  const rows = params.status
    ? await all<VoteRow>(db, `SELECT * FROM votes WHERE status = ? ORDER BY created_at DESC`, [params.status])
    : await all<VoteRow>(db, `SELECT * FROM votes ORDER BY created_at DESC`);

  return Promise.all(
    rows.map(async (row) => ({
      ...toVoteSummary(row),
      candidates: row.vote_type === "election" ? await getCandidates(db, row.id) : null,
    })),
  );
}

// ── Admin: raw ballot audit (§7 "Full ballot breakdown (staff only)") ────

export interface AdminBallotRow {
  id: string;
  userId: string;
  organizationId: string | null;
  choice: string;
  round: number;
  submittedAt: string;
}

export async function listBallotsForAdmin(db: DatabaseLike, voteId: string): Promise<AdminBallotRow[]> {
  await getVoteRowOrThrow(db, voteId);
  const rows = await all<{
    id: string;
    user_id: string;
    organization_id: string | null;
    choice: string;
    round: number;
    submitted_at: string;
  }>(
    db,
    `SELECT id, user_id, organization_id, choice, round, submitted_at FROM vote_ballots WHERE vote_id = ? ORDER BY round ASC, submitted_at ASC`,
    [voteId],
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    organizationId: r.organization_id,
    choice: r.choice,
    round: r.round,
    submittedAt: r.submitted_at,
  }));
}

// ── Eligibility & ballot submission ───────────────────────────────────────

async function assertVotingCategory(member: AuthMember): Promise<void> {
  if (!VOTING_CATEGORIES.has(member.membershipCategory)) {
    throw new AppError(403, "H_CATEGORY_CANNOT_VOTE", "H-category members cannot cast a ballot");
  }
}

interface OrgDelegateRow {
  id: string;
  primary_contact_user_id: string | null;
  voting_delegate_user_id: string | null;
}

/** organizations.voting_delegate_user_id NULL falls back to primary_contact_user_id (§4.8). */
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
 * (§4.8: "When a vote opens, the portal notifies the current delegate by
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

// ── Closing & tallying (scheduled job — see membership-scheduled-jobs.ts) ─

export interface CloseDueVotesResult {
  /** scheduled -> open transitions (initial open, not a round advance). */
  opened: string[];
  closed: string[];
  /** Election votes that advanced to a new round without a winner yet. */
  roundsAdvanced: string[];
}

async function finalizeMotionOrConsultation(db: DatabaseLike, vote: VoteRow): Promise<void> {
  const ballots = await all<{ choice: string }>(db, `SELECT choice FROM vote_ballots WHERE vote_id = ? AND round = ?`, [
    vote.id,
    vote.current_round,
  ]);
  const result = computeMotionResult(vote.threshold_type as "simple_majority" | "supermajority", ballots);
  await run(db, `UPDATE votes SET status = 'closed', result_json = ?, updated_at = ? WHERE id = ?`, [
    stringifyJson(result),
    nowIso(),
    vote.id,
  ]);
}

async function advanceOrFinalizeElection(db: DatabaseLike, vote: VoteRow): Promise<void> {
  const standing = await all<CandidateRow>(
    db,
    `SELECT * FROM vote_candidates WHERE vote_id = ? AND eliminated_round IS NULL ORDER BY sort_order ASC`,
    [vote.id],
  );
  const ballots = await all<{ choice: string }>(db, `SELECT choice FROM vote_ballots WHERE vote_id = ? AND round = ?`, [
    vote.id,
    vote.current_round,
  ]);
  const tally = tallyElectionRound(
    vote.current_round,
    standing.map((c) => c.id),
    ballots,
  );

  const priorRounds = parseJsonSafe<{ rounds: ElectionRoundTally[] }>(vote.result_json, { rounds: [] }).rounds;
  const rounds = [...priorRounds, tally];
  const now = nowIso();

  if (tally.winnerCandidateId || standing.length <= 1) {
    const winnerId = tally.winnerCandidateId ?? standing[0]?.id ?? null;
    await run(db, `UPDATE votes SET status = 'closed', result_json = ?, updated_at = ? WHERE id = ?`, [
      stringifyJson({ rounds, winnerCandidateId: winnerId }),
      now,
      vote.id,
    ]);
    return;
  }

  if (tally.eliminatedCandidateIds.length > 0) {
    for (const candidateId of tally.eliminatedCandidateIds) {
      await run(db, `UPDATE vote_candidates SET eliminated_round = ? WHERE id = ?`, [vote.current_round, candidateId]);
    }
  }
  // If nobody could be eliminated (full tie among all standing candidates),
  // the round re-runs unchanged — see this file's header.

  const durationMs = new Date(vote.closes_at).getTime() - new Date(vote.opens_at).getTime();
  const nextClosesAt = new Date(Date.now() + Math.max(durationMs, 60 * 60 * 1000)).toISOString();
  await run(
    db,
    `UPDATE votes SET current_round = current_round + 1, opens_at = ?, closes_at = ?, result_json = ?, updated_at = ? WHERE id = ?`,
    [now, nextClosesAt, stringifyJson({ rounds }), now, vote.id],
  );
}

/**
 * Opens scheduled votes whose opens_at has passed, then closes/advances
 * open votes whose closes_at has passed. Returns which votes newly opened,
 * closed, or advanced a round, so the caller (membership-scheduled-jobs.ts)
 * can resolve each forum vote's eligible delegates and queue
 * `forum-vote-delegate-notify` — this function never calls queueEmail
 * itself, matching every other service in this codebase.
 */
export async function closeDueVotes(db: DatabaseLike, limit = 50): Promise<CloseDueVotesResult> {
  const now = nowIso();

  const toOpen = await all<{ id: string }>(
    db,
    `SELECT id FROM votes WHERE status = 'scheduled' AND opens_at <= ? LIMIT ?`,
    [now, limit],
  );
  for (const row of toOpen) {
    await run(db, `UPDATE votes SET status = 'open', updated_at = ? WHERE id = ?`, [now, row.id]);
  }

  const toClose = await all<VoteRow>(db, `SELECT * FROM votes WHERE status = 'open' AND closes_at <= ? LIMIT ?`, [
    now,
    limit,
  ]);

  const closed: string[] = [];
  const roundsAdvanced: string[] = [];

  for (const vote of toClose) {
    if (vote.vote_type === "election") {
      const beforeRound = vote.current_round;
      await advanceOrFinalizeElection(db, vote);
      const after = await getVoteRowOrThrow(db, vote.id);
      if (after.status === "closed") closed.push(vote.id);
      else if (after.current_round !== beforeRound) roundsAdvanced.push(vote.id);
    } else {
      await finalizeMotionOrConsultation(db, vote);
      closed.push(vote.id);
    }
  }

  return { opened: toOpen.map((r) => r.id), closed, roundsAdvanced };
}

// ── Public (no auth) — §7 "Votes (public — no auth required)" ────────────

export interface PublicVoteListParams {
  type?: VoteType;
  scope?: VoteScopeType;
  wg?: string;
  status?: "open" | "closed";
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
  sort?: "closes_at" | "created_at";
}

export interface PublicVoteSummary extends VoteSummary {
  candidates: CandidateSummary[] | null;
  result: unknown;
}

async function toPublicVoteSummary(db: DatabaseLike, row: VoteRow): Promise<PublicVoteSummary> {
  const summary = toVoteSummary(row);
  const candidates = row.vote_type === "election" ? await getCandidates(db, row.id) : null;
  const result = publicResultForDetailLevel(row);
  return { ...summary, candidates, result };
}

function publicResultForDetailLevel(row: VoteRow): unknown {
  if (row.status !== "closed" || !row.result_json) return null;
  const full = parseJsonSafe<Record<string, unknown>>(row.result_json, {});
  if (row.public_detail_level === "outcome_only") {
    return { outcome: full.outcome ?? (full.winnerCandidateId ? "decided" : null) };
  }
  // aggregate and full_breakdown (full_breakdown never contains voter
  // identities to begin with — result_json only stores counts, never
  // user_id — so "full_breakdown" and "aggregate" are equivalent here; the
  // distinction only matters for the staff-only raw ballots endpoint).
  return full;
}

export async function listPublicVotes(
  db: DatabaseLike,
  params: PublicVoteListParams,
): Promise<{ votes: PublicVoteSummary[]; total: number }> {
  const conditions = ["visibility = 'public'"];
  const args: unknown[] = [];

  if (params.type) {
    conditions.push("vote_type = ?");
    args.push(params.type);
  }
  if (params.scope) {
    conditions.push("scope_type = ?");
    args.push(params.scope);
  }
  if (params.wg) {
    const wg = await getWorkingGroupBySlugOrId(db, params.wg);
    conditions.push("scope_id = ?");
    args.push(wg?.id ?? "__none__");
  }
  if (params.status === "open") {
    conditions.push("status = 'open'");
  } else if (params.status === "closed") {
    conditions.push("status = 'closed'");
  }
  if (params.from) {
    conditions.push("closes_at >= ?");
    args.push(params.from);
  }
  if (params.to) {
    conditions.push("closes_at <= ?");
    args.push(params.to);
  }

  const sortColumn = params.sort === "created_at" ? "created_at" : "closes_at";
  const perPage = Math.min(Math.max(params.perPage ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const offset = (page - 1) * perPage;

  const where = conditions.join(" AND ");
  const rows = await all<VoteRow>(
    db,
    `SELECT * FROM votes WHERE ${where} ORDER BY ${sortColumn} DESC LIMIT ? OFFSET ?`,
    [...args, perPage, offset],
  );
  const totalRow = await first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM votes WHERE ${where}`, args);

  const votes = await Promise.all(rows.map((r) => toPublicVoteSummary(db, r)));
  return { votes, total: totalRow?.total ?? 0 };
}

export async function getPublicVoteBySlug(db: DatabaseLike, slug: string): Promise<PublicVoteSummary> {
  const row = await first<VoteRow>(db, `SELECT * FROM votes WHERE slug = ? AND visibility = 'public'`, [slug]);
  if (!row) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  return toPublicVoteSummary(db, row);
}

export async function listPublicVotesForFeed(db: DatabaseLike, limit = 50): Promise<PublicVoteSummary[]> {
  const rows = await all<VoteRow>(
    db,
    `SELECT * FROM votes WHERE visibility = 'public' ORDER BY closes_at DESC LIMIT ?`,
    [limit],
  );
  return Promise.all(rows.map((r) => toPublicVoteSummary(db, r)));
}

// ── Portal (authenticated members) — §7 ────────────────────────────────────

export interface PortalVoteSummary extends VoteSummary {
  candidates: CandidateSummary[] | null;
  canCastBallot: boolean;
  hasCastBallot: boolean;
  result: unknown | null;
}

async function memberCanCastBallot(db: DatabaseLike, vote: VoteRow, member: AuthMember): Promise<boolean> {
  if (vote.status !== "open") return false;
  if (!VOTING_CATEGORIES.has(member.membershipCategory)) return false;
  const restriction = eligibleCategoriesOf(vote);
  if (restriction && !restriction.includes(member.membershipCategory)) return false;

  if (vote.scope_type === "forum") {
    if (!member.organizationId) return false;
    const delegateId = await resolveVotingDelegateUserId(db, member.organizationId);
    return delegateId === member.userId;
  }
  const membership = await first<{ id: string }>(
    db,
    `SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
    [vote.scope_id, member.userId],
  );
  return Boolean(membership);
}

async function memberHasCastBallot(db: DatabaseLike, vote: VoteRow, member: AuthMember): Promise<boolean> {
  if (vote.scope_type === "forum") {
    if (!member.organizationId) return false;
    const row = await first<{ id: string }>(
      db,
      `SELECT id FROM vote_ballots WHERE vote_id = ? AND organization_id = ? AND round = ?`,
      [vote.id, member.organizationId, vote.current_round],
    );
    return Boolean(row);
  }
  const row = await first<{ id: string }>(
    db,
    `SELECT id FROM vote_ballots WHERE vote_id = ? AND user_id = ? AND round = ? AND organization_id IS NULL`,
    [vote.id, member.userId, vote.current_round],
  );
  return Boolean(row);
}

async function toPortalVoteSummary(db: DatabaseLike, row: VoteRow, member: AuthMember): Promise<PortalVoteSummary> {
  const summary = toVoteSummary(row);
  const candidates = row.vote_type === "election" ? await getCandidates(db, row.id) : null;
  const canCastBallot = await memberCanCastBallot(db, row, member);
  const hasCastBallot = await memberHasCastBallot(db, row, member);
  const result = row.status === "closed" ? parseJsonSafe<Record<string, unknown>>(row.result_json, {}) : null;
  return { ...summary, candidates, canCastBallot, hasCastBallot, result };
}

/** Votes visible to a member: public ones, plus every WG they belong to, plus every forum vote. */
export async function listVisibleVotesForMember(db: DatabaseLike, member: AuthMember): Promise<PortalVoteSummary[]> {
  const wgRows = await all<{ working_group_id: string }>(
    db,
    `SELECT working_group_id FROM working_group_members WHERE user_id = ? AND left_at IS NULL`,
    [member.userId],
  );
  const wgIds = wgRows.map((r) => r.working_group_id);

  const conditions = ["(scope_type = 'forum' OR visibility = 'public')"];
  const args: unknown[] = [];
  if (wgIds.length > 0) {
    conditions.push(`OR (scope_type = 'working_group' AND scope_id IN (${wgIds.map(() => "?").join(", ")}))`);
    args.push(...wgIds);
  }

  const rows = await all<VoteRow>(
    db,
    `SELECT * FROM votes WHERE ${conditions.join(" ")} ORDER BY closes_at DESC`,
    args,
  );
  return Promise.all(rows.map((r) => toPortalVoteSummary(db, r, member)));
}

export async function getVoteDetailForMember(
  db: DatabaseLike,
  member: AuthMember,
  voteIdOrSlug: string,
): Promise<PortalVoteSummary> {
  const row = await getVoteRowOrThrow(db, voteIdOrSlug);
  if (row.scope_type === "working_group" && row.visibility !== "public") {
    const membership = await first<{ id: string }>(
      db,
      `SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
      [row.scope_id, member.userId],
    );
    if (!membership) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  }
  return toPortalVoteSummary(db, row, member);
}

export async function getVoteResultsForMember(db: DatabaseLike, voteIdOrSlug: string): Promise<unknown> {
  const row = await getVoteRowOrThrow(db, voteIdOrSlug);
  if (row.status !== "closed") {
    throw new AppError(409, "VOTE_NOT_CLOSED", "Results are hidden until the vote closes");
  }
  return parseJsonSafe<Record<string, unknown>>(row.result_json, {});
}

// ── /api/v1/me/votes (PRD §4.10, replaces the Phase 4A stub) ─────────────

export interface MyVoteHistoryEntry {
  voteId: string;
  slug: string;
  title: string;
  voteType: VoteType;
  scopeType: VoteScopeType;
  status: VoteStatus;
  choice: string;
  submittedAt: string;
}

export async function listMyVoteHistory(db: DatabaseLike, member: AuthMember): Promise<MyVoteHistoryEntry[]> {
  const rows = await all<{
    vote_id: string;
    slug: string;
    title: string;
    vote_type: VoteType;
    scope_type: VoteScopeType;
    status: VoteStatus;
    choice: string;
    submitted_at: string;
  }>(
    db,
    `SELECT b.vote_id, v.slug, v.title, v.vote_type, v.scope_type, v.status, b.choice, b.submitted_at
     FROM vote_ballots b JOIN votes v ON v.id = b.vote_id
     WHERE b.user_id = ? ORDER BY b.submitted_at DESC`,
    [member.userId],
  );
  return rows.map((r) => ({
    voteId: r.vote_id,
    slug: r.slug,
    title: r.title,
    voteType: r.vote_type,
    scopeType: r.scope_type,
    status: r.status,
    choice: r.choice,
    submittedAt: r.submitted_at,
  }));
}

// ── Vote proposals (§4.8 Path B — CA/Browser Forum endorsement model) ────

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
  status: string;
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
  status: string;
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
  params: { scopeType?: VoteScopeType; scopeId?: string; status?: string },
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
  params: { status?: string },
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

  await run(
    db,
    `INSERT INTO votes
       (id, slug, title, description, vote_type, scope_type, scope_id, created_by_user_id, proposed_by_user_id,
        eligible_categories, threshold_type, opens_at, closes_at, current_round, status, result_json,
        visibility, public_detail_level, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, ?, NULL, 'private', 'aggregate', ?, ?)`,
    [
      id,
      slug,
      proposal.title,
      proposal.description,
      proposal.vote_type,
      proposal.scope_type,
      proposal.scope_id,
      proposal.proposed_by_user_id,
      proposal.eligible_categories,
      thresholdType,
      opensAt,
      closesAt,
      status,
      now,
      now,
    ],
  );

  await run(db, `UPDATE vote_proposals SET status = 'converted_to_vote', vote_id = ?, updated_at = ? WHERE id = ?`, [
    id,
    now,
    proposal.id,
  ]);

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

// ── Admin proposal moderation (§7 "staff admin / WG chair in context") ───

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
