/**
 * votes.test.ts
 *
 * direct vote creation (staff/WG chair), forum vs
 * working-group ballot eligibility, threshold tallying (simple majority,
 * successive elimination across rounds), the member-proposal + endorsement
 * conversion path, admin proposal moderation, visibility, and /me/votes.
 * Mirrors meeting-calendar.test.ts's setup/auth pattern.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import {
  seedOrganizationAggregate,
  addRepresentative,
  assignRepresentativeRole,
  REPRESENTATIVE_ROLE_IDS,
} from "./helpers/membership";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { isIndividualMembershipCategory } from "../assets/shared/schemas/membership-categories";
import { closeDueVotes } from "../functions/_lib/services/votes";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function callAnon(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    env as any,
    {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any,
  );
}

let userCounter = 0;

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  return id;
}

async function insertOrganization(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(id, name, name.toLowerCase())
    .run();
  return id;
}

/**
 * Sets the organization's primary contact and (optionally) voting delegate
 * via role-primary_contact/role-voting_delegate grants (migration 0038) —
 * the same mechanism resolveVotingDelegateUserId (votes/ballots.ts) reads.
 * `primaryContactUserId`/`votingDelegateUserId` must already be active
 * representatives of this organization (insertMemberUser adds them as such
 * when called with an organizationId).
 */
async function setOrgContacts(
  orgId: string,
  primaryContactUserId: string | null,
  votingDelegateUserId: string | null = null,
): Promise<void> {
  const memberId = await seedOrganizationAggregate(env.DB, orgId);
  if (primaryContactUserId) {
    await assignRepresentativeRole(env.DB, memberId, primaryContactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
  }
  if (votingDelegateUserId) {
    await assignRepresentativeRole(env.DB, memberId, votingDelegateUserId, REPRESENTATIVE_ROLE_IDS.votingDelegate);
  }
}

/**
 * Creates a user + active membership in one call, category A-G by default.
 * Individual-only categories (H5/H6/H7) get an org-less individual
 * aggregate; every other category is inherently organization-tied
 * (functions/_lib/services/membership/memberships.ts now enforces this —
 * PR #1 review flagged tests that previously created impossible
 * individual+org-category combinations), so `organizationId` is reused
 * when given or a fresh organization is synthesized otherwise. Several
 * ballot-eligibility tests below pass a voting category (e.g. "F") with no
 * explicit `organizationId` to isolate WG-level eligibility from
 * forum-level org-contact resolution — a bare representative row (no
 * primary-contact/voting-delegate role) still achieves that isolation.
 */
async function insertMemberUser(category: string, organizationId: string | null = null): Promise<string> {
  userCounter += 1;
  const userId = await insertUser(`voter-${userCounter}@example.test`);
  if (isIndividualMembershipCategory(category)) {
    const { statements } = buildCreateIndividualMemberStatements(env.DB, userId, category, new Date().toISOString());
    await env.DB.batch(statements);
  } else {
    const orgId = organizationId ?? (await insertOrganization(`Voter Org ${crypto.randomUUID()}`));
    const memberId = await seedOrganizationAggregate(env.DB, orgId, category);
    await addRepresentative(env.DB, memberId, userId);
  }
  return userId;
}

async function insertWorkingGroup(name: string, slug: string, minEndorsers = 0): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO working_groups (id, name, slug, description, mailing_list_email, min_endorsers_for_ballot, active, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, name, slug, minEndorsers)
    .run();
  return id;
}

async function insertWgMembership(wgId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at) VALUES (?, ?, ?, datetime('now'), NULL)`,
  )
    .bind(crypto.randomUUID(), wgId, userId)
    .run();
}

async function assignContextualRole(
  userId: string,
  roleId: string,
  contextType: string,
  contextId: string,
  grantedBy: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, roleId, contextType, contextId, grantedBy)
    .run();
}

describe("Voting system", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-votes-token");
    userCounter = 0;
  });

  // ── Direct creation (Path A) ──────────────────────────────────────────

  it("staff admin creates a forum-scoped motion vote directly", async () => {
    const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Adopt New Bylaws",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vote: { id: string; status: string; slug: string } };
    expect(body.vote.status).toBe("open");
    expect(body.vote.slug).toBe("adopt-new-bylaws");
  });

  it("election votes require >=2 candidates, and successive_elimination requires >=3", async () => {
    const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const noCandidates = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Chair Election",
        voteType: "election",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt,
        candidates: [{ name: "Alice" }],
      }),
    });
    expect(noCandidates.status).toBe(422);

    const twoCandidatesElimination = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Chair Election 2",
        voteType: "election",
        scopeType: "forum",
        thresholdType: "successive_elimination",
        closesAt,
        candidates: [{ name: "Alice" }, { name: "Bob" }],
      }),
    });
    expect(twoCandidatesElimination.status).toBe(422);
  });

  it("atomicity (PR #1 review §5.3): a candidate-insert failure leaves no vote row and no candidate rows behind", async () => {
    const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const votesBefore = await queryAll(env.DB, "SELECT id FROM votes");
    const candidatesBefore = await queryAll(env.DB, "SELECT id FROM vote_candidates");

    const response = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Doomed Election",
        voteType: "election",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt,
        candidates: [
          { name: "Alice" },
          // A syntactically valid but non-existent user id — violates
          // vote_candidates.user_id's FK, forcing a failure mid-sequence
          // (not on the first candidate) rather than before any statement
          // was built at all.
          { name: "Bob", userId: "00000000-0000-4000-8000-000000000000" },
        ],
      }),
    });
    expect(response.status).not.toBe(200);

    const votesAfter = await queryAll(env.DB, "SELECT id FROM votes");
    expect(votesAfter).toHaveLength(votesBefore.length);

    const candidatesAfter = await queryAll(env.DB, "SELECT id FROM vote_candidates");
    expect(candidatesAfter).toHaveLength(candidatesBefore.length);
  });

  it("a WG chair (context-scoped votes:create) can create a vote for their own WG but not another WG", async () => {
    const ownWgId = await insertWorkingGroup("Own WG", "own-wg-vote");
    const otherWgId = await insertWorkingGroup("Other WG", "other-wg-vote");
    const chairUserId = await insertUser("wg-chair-votes@example.test");
    await assignContextualRole(chairUserId, "role-wg_chair", "working_group", ownWgId, adminId);
    const chairToken = await createAdminSession(env.DB, chairUserId, "wg-chair-votes-token");
    const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const ownRes = await call(chairToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "WG Motion",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: ownWgId,
        thresholdType: "simple_majority",
        closesAt,
      }),
    });
    expect(ownRes.status).toBe(200);

    const otherRes = await call(chairToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Should Not Be Created",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: otherWgId,
        thresholdType: "simple_majority",
        closesAt,
      }),
    });
    expect(otherRes.status).toBe(403);
  });

  // ── Ballot eligibility & submission ───────────────────────────────────

  it("forum ballot: only the resolved voting delegate (default primary contact) may cast, one ballot per organization per round", async () => {
    const orgId = await insertOrganization("Acme Corp");
    const primaryUserId = await insertMemberUser("A", orgId);
    const otherRepUserId = await insertMemberUser("A", orgId);
    await setOrgContacts(orgId, primaryUserId);

    const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Forum Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt,
      }),
    });
    const { vote } = (await createRes.json()) as { vote: { id: string } };

    const primaryToken = await createMemberSession(env.DB, primaryUserId, "primary-token");
    const otherToken = await createMemberSession(env.DB, otherRepUserId, "other-rep-token");

    const notDelegateRes = await call(otherToken, `/api/v1/portal/votes/${vote.id}/ballots`, {
      method: "POST",
      body: JSON.stringify({ choice: "in_favor" }),
    });
    expect(notDelegateRes.status).toBe(403);

    const castRes = await call(primaryToken, `/api/v1/portal/votes/${vote.id}/ballots`, {
      method: "POST",
      body: JSON.stringify({ choice: "in_favor" }),
    });
    expect(castRes.status).toBe(200);

    const secondCastRes = await call(primaryToken, `/api/v1/portal/votes/${vote.id}/ballots`, {
      method: "POST",
      body: JSON.stringify({ choice: "opposed" }),
    });
    expect(secondCastRes.status).toBe(409);

    // Delegate change mid-vote: the already-cast ballot stands — the new
    // delegate cannot cast a second ballot for the same organization/round.
    await setOrgContacts(orgId, primaryUserId, otherRepUserId);
    const newDelegateToken = await createMemberSession(env.DB, otherRepUserId, "new-delegate-token");
    const newDelegateRes = await call(newDelegateToken, `/api/v1/portal/votes/${vote.id}/ballots`, {
      method: "POST",
      body: JSON.stringify({ choice: "opposed" }),
    });
    expect(newDelegateRes.status).toBe(409);
  });

  it("H-category members cannot cast a ballot at any level", async () => {
    const wgId = await insertWorkingGroup("H Test WG", "h-test-wg");
    const hUserId = await insertMemberUser("H1");
    await insertWgMembership(wgId, hUserId);
    const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "WG Motion H-Test",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: wgId,
        thresholdType: "simple_majority",
        closesAt,
      }),
    });
    const { vote } = (await createRes.json()) as { vote: { id: string } };
    const hToken = await createMemberSession(env.DB, hUserId, "h-member-token");

    const res = await call(hToken, `/api/v1/portal/votes/${vote.id}/ballots`, {
      method: "POST",
      body: JSON.stringify({ choice: "in_favor" }),
    });
    expect(res.status).toBe(403);
  });

  it("working-group ballot: only active members of that WG may cast", async () => {
    const wgId = await insertWorkingGroup("WG Ballot Test", "wg-ballot-test");
    const memberUserId = await insertMemberUser("F");
    await insertWgMembership(wgId, memberUserId);
    const nonMemberUserId = await insertMemberUser("F");
    const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "WG Ballot Motion",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: wgId,
        thresholdType: "simple_majority",
        closesAt,
      }),
    });
    const { vote } = (await createRes.json()) as { vote: { id: string } };

    const nonMemberToken = await createMemberSession(env.DB, nonMemberUserId, "non-member-token");
    const nonMemberRes = await call(nonMemberToken, `/api/v1/portal/votes/${vote.id}/ballots`, {
      method: "POST",
      body: JSON.stringify({ choice: "in_favor" }),
    });
    expect(nonMemberRes.status).toBe(403);

    const memberToken = await createMemberSession(env.DB, memberUserId, "wg-member-token");
    const memberRes = await call(memberToken, `/api/v1/portal/votes/${vote.id}/ballots`, {
      method: "POST",
      body: JSON.stringify({ choice: "in_favor" }),
    });
    expect(memberRes.status).toBe(200);
  });

  // ── Tallying / closing ────────────────────────────────────────────────

  it("closeDueVotes finalizes a simple_majority motion as passed or failed", async () => {
    const wgId = await insertWorkingGroup("Tally WG", "tally-wg");
    const voterA = await insertMemberUser("F");
    const voterB = await insertMemberUser("F");
    const voterC = await insertMemberUser("F");
    for (const v of [voterA, voterB, voterC]) await insertWgMembership(wgId, v);

    const closesAt = new Date(Date.now() + 1000).toISOString();
    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Pass This Motion",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: wgId,
        thresholdType: "simple_majority",
        closesAt,
      }),
    });
    const { vote } = (await createRes.json()) as { vote: { id: string } };

    for (const [voterId, choice] of [
      [voterA, "in_favor"],
      [voterB, "in_favor"],
      [voterC, "opposed"],
    ] as const) {
      const token = await createMemberSession(env.DB, voterId, `tally-${voterId}`);
      const res = await call(token, `/api/v1/portal/votes/${vote.id}/ballots`, {
        method: "POST",
        body: JSON.stringify({ choice }),
      });
      expect(res.status).toBe(200);
    }

    await new Promise((r) => setTimeout(r, 1100));
    await closeDueVotes(env.DB);

    const rows = await queryAll<{ status: string; result_json: string }>(
      env.DB,
      "SELECT status, result_json FROM votes WHERE id = ?",
      vote.id,
    );
    expect(rows[0].status).toBe("closed");
    const result = JSON.parse(rows[0].result_json);
    expect(result.outcome).toBe("passed");
    expect(result.counts).toEqual({ in_favor: 2, opposed: 1, abstain: 0 });
  });

  it("successive_elimination election advances a round when nobody has a majority, then closes with a winner", async () => {
    const wgId = await insertWorkingGroup("Election WG", "election-wg");
    const voters = await Promise.all([1, 2, 3, 4, 5].map(() => insertMemberUser("F")));
    for (const v of voters) await insertWgMembership(wgId, v);

    const closesAt = new Date(Date.now() + 1000).toISOString();
    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "WG Chair Election",
        voteType: "election",
        scopeType: "working_group",
        scopeId: wgId,
        thresholdType: "successive_elimination",
        closesAt,
        candidates: [{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }],
      }),
    });
    const { vote } = (await createRes.json()) as { vote: { id: string } };

    const detailRes = await call(adminToken, `/api/v1/admin/votes/${vote.id}/ballots`);
    expect(detailRes.status).toBe(200);
    const candidatesRes = await call(
      await createMemberSession(env.DB, voters[0], "peek"),
      `/api/v1/portal/votes/${vote.id}`,
    );
    const { vote: voteDetail } = (await candidatesRes.json()) as {
      vote: { candidates: Array<{ id: string; candidateName: string }> };
    };
    const alice = voteDetail.candidates!.find((c) => c.candidateName === "Alice")!;
    const bob = voteDetail.candidates!.find((c) => c.candidateName === "Bob")!;
    const carol = voteDetail.candidates!.find((c) => c.candidateName === "Carol")!;

    // Round 1: Alice 2, Bob 2, Carol 1 — no majority, Carol eliminated (fewest).
    const round1Choices = [alice.id, alice.id, bob.id, bob.id, carol.id];
    for (let i = 0; i < voters.length; i++) {
      const token = await createMemberSession(env.DB, voters[i], `round1-${i}`);
      const res = await call(token, `/api/v1/portal/votes/${vote.id}/ballots`, {
        method: "POST",
        body: JSON.stringify({ choice: round1Choices[i] }),
      });
      expect(res.status).toBe(200);
    }

    await new Promise((r) => setTimeout(r, 1100));
    await closeDueVotes(env.DB);

    const afterRound1 = await queryAll<{ status: string; current_round: number }>(
      env.DB,
      "SELECT status, current_round FROM votes WHERE id = ?",
      vote.id,
    );
    expect(afterRound1[0].status).toBe("open");
    expect(afterRound1[0].current_round).toBe(2);

    const eliminated = await queryAll<{ eliminated_round: number | null }>(
      env.DB,
      "SELECT eliminated_round FROM vote_candidates WHERE id = ?",
      carol.id,
    );
    expect(eliminated[0].eliminated_round).toBe(1);

    // Round 2: everyone recasts between Alice/Bob, Alice gets a majority.
    const round2Choices = [alice.id, alice.id, alice.id, bob.id, bob.id];
    for (let i = 0; i < voters.length; i++) {
      const token = await createMemberSession(env.DB, voters[i], `round2-${i}`);
      const res = await call(token, `/api/v1/portal/votes/${vote.id}/ballots`, {
        method: "POST",
        body: JSON.stringify({ choice: round2Choices[i] }),
      });
      expect(res.status).toBe(200);
    }

    await env.DB.prepare("UPDATE votes SET closes_at = datetime('now', '-1 second') WHERE id = ?").bind(vote.id).run();
    await closeDueVotes(env.DB);

    const final = await queryAll<{ status: string; result_json: string }>(
      env.DB,
      "SELECT status, result_json FROM votes WHERE id = ?",
      vote.id,
    );
    expect(final[0].status).toBe("closed");
    const result = JSON.parse(final[0].result_json);
    expect(result.winnerCandidateId).toBe(alice.id);
  });

  // ── Vote proposals (Path B — endorsement) ─────────────────────────────

  it("a member proposal auto-converts to an active vote once the endorsement threshold is reached", async () => {
    const wgId = await insertWorkingGroup("Proposal WG", "proposal-wg", 2);
    const proposerId = await insertMemberUser("F");
    const endorser1 = await insertMemberUser("F");
    const endorser2 = await insertMemberUser("F");
    for (const u of [proposerId, endorser1, endorser2]) await insertWgMembership(wgId, u);

    const proposerToken = await createMemberSession(env.DB, proposerId, "proposer-token");
    const submitRes = await call(proposerToken, "/api/v1/portal/vote-proposals", {
      method: "POST",
      body: JSON.stringify({
        title: "Change Meeting Time",
        description: "Move the weekly call an hour earlier.",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: wgId,
      }),
    });
    expect(submitRes.status).toBe(200);
    const { proposal } = (await submitRes.json()) as { proposal: { id: string; status: string } };
    expect(proposal.status).toBe("open_for_endorsement");

    const endorser1Token = await createMemberSession(env.DB, endorser1, "endorser1-token");
    const firstEndorse = await call(endorser1Token, `/api/v1/portal/vote-proposals/${proposal.id}/endorse`, {
      method: "POST",
    });
    expect(firstEndorse.status).toBe(200);
    const firstBody = (await firstEndorse.json()) as { convertedVote: unknown };
    expect(firstBody.convertedVote).toBeNull();

    const endorser2Token = await createMemberSession(env.DB, endorser2, "endorser2-token");
    const secondEndorse = await call(endorser2Token, `/api/v1/portal/vote-proposals/${proposal.id}/endorse`, {
      method: "POST",
    });
    expect(secondEndorse.status).toBe(200);
    const secondBody = (await secondEndorse.json()) as {
      proposal: { status: string };
      convertedVote: { id: string } | null;
    };
    expect(secondBody.proposal.status).toBe("converted_to_vote");
    expect(secondBody.convertedVote).not.toBeNull();

    const voteRows = await queryAll<{ id: string }>(env.DB, "SELECT id FROM votes WHERE title = 'Change Meeting Time'");
    expect(voteRows).toHaveLength(1);
  });

  it("atomicity (PR #1 review §5.4): two concurrent admin approvals of the same proposal converge on exactly one vote", async () => {
    const wgId = await insertWorkingGroup("Race WG", "race-wg", 5);
    const proposerId = await insertMemberUser("F");
    await insertWgMembership(wgId, proposerId);
    const proposerToken = await createMemberSession(env.DB, proposerId, "race-proposer-token");

    const submitRes = await call(proposerToken, "/api/v1/portal/vote-proposals", {
      method: "POST",
      body: JSON.stringify({
        title: "Racing Conversion",
        description: "N/A",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: wgId,
      }),
    });
    const { proposal } = (await submitRes.json()) as { proposal: { id: string } };

    const [first, second] = await Promise.all([
      call(adminToken, `/api/v1/admin/vote-proposals/${proposal.id}/approve`, { method: "POST" }),
      call(adminToken, `/api/v1/admin/vote-proposals/${proposal.id}/approve`, { method: "POST" }),
    ]);

    // The winner always gets 200 with the vote it created. The loser either
    // also gets 200 (re-reading the winner's vote via convertProposalToVote's
    // CAS fallback, if its own read-check raced ahead of the winner's write)
    // or 409 from approveVoteProposal's own pre-existing read-check (if it
    // ran after the winner's write already committed) — both are correct;
    // what must never happen is a second vote or an unhandled error.
    expect(first.status).not.toBe(500);
    expect(second.status).not.toBe(500);
    for (const status of [first.status, second.status]) {
      expect([200, 409]).toContain(status);
    }
    expect([first.status, second.status]).toContain(200);

    const voteRows = await queryAll<{ id: string }>(env.DB, "SELECT id FROM votes WHERE title = 'Racing Conversion'");
    expect(voteRows).toHaveLength(1);

    for (const res of [first, second]) {
      if (res.status !== 200) continue;
      const body = (await res.json()) as { convertedVote: { id: string } };
      expect(body.convertedVote.id).toBe(voteRows[0].id);
    }

    const proposalRows = await queryAll<{ status: string; vote_id: string }>(
      env.DB,
      "SELECT status, vote_id FROM vote_proposals WHERE id = ?",
      proposal.id,
    );
    expect(proposalRows[0].status).toBe("converted_to_vote");
    expect(proposalRows[0].vote_id).toBe(voteRows[0].id);
  });

  it("proposal submission is disabled when the scope's min_endorsers is 0", async () => {
    const wgId = await insertWorkingGroup("No Endorsement WG", "no-endorse-wg", 0);
    const proposerId = await insertMemberUser("F");
    await insertWgMembership(wgId, proposerId);
    const token = await createMemberSession(env.DB, proposerId, "no-endorse-token");

    const res = await call(token, "/api/v1/portal/vote-proposals", {
      method: "POST",
      body: JSON.stringify({
        title: "Should Be Blocked",
        description: "N/A",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: wgId,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("admin can approve a proposal directly (bypassing endorsement count) and reject one with a notification email", async () => {
    const wgId = await insertWorkingGroup("Admin Moderation WG", "admin-mod-wg", 5);
    const proposerId = await insertMemberUser("F");
    await insertWgMembership(wgId, proposerId);
    const proposerToken = await createMemberSession(env.DB, proposerId, "mod-proposer-token");

    const submitRes = await call(proposerToken, "/api/v1/portal/vote-proposals", {
      method: "POST",
      body: JSON.stringify({
        title: "Approve Me",
        description: "N/A",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: wgId,
      }),
    });
    const { proposal: approveTarget } = (await submitRes.json()) as { proposal: { id: string } };

    const approveRes = await call(adminToken, `/api/v1/admin/vote-proposals/${approveTarget.id}/approve`, {
      method: "POST",
    });
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as { convertedVote: { id: string } };
    expect(approveBody.convertedVote.id).toBeTruthy();

    const submitRes2 = await call(proposerToken, "/api/v1/portal/vote-proposals", {
      method: "POST",
      body: JSON.stringify({
        title: "Reject Me",
        description: "N/A",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: wgId,
      }),
    });
    const { proposal: rejectTarget } = (await submitRes2.json()) as { proposal: { id: string } };

    const rejectRes = await call(adminToken, `/api/v1/admin/vote-proposals/${rejectTarget.id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: "Not enough detail" }),
    });
    expect(rejectRes.status).toBe(200);

    const emailRows = await queryAll<{ recipient_email: string }>(
      env.DB,
      "SELECT recipient_email FROM email_outbox WHERE template_key = 'vote-proposal-rejected'",
    );
    expect(emailRows).toHaveLength(1);
  });

  // ── Visibility & public surface ────────────────────────────────────────

  it("public GET /api/v1/votes only returns visibility=public votes, respecting outcome_only detail level", async () => {
    const closesAt = new Date(Date.now() + 1000).toISOString();
    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Public Vote Test",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt,
      }),
    });
    const { vote } = (await createRes.json()) as { vote: { id: string; slug: string } };

    const hiddenRes = await callAnon(`/api/v1/votes/${vote.slug}`);
    expect(hiddenRes.status).toBe(404);

    await new Promise((r) => setTimeout(r, 1100));
    await closeDueVotes(env.DB);

    const visRes = await call(adminToken, `/api/v1/admin/votes/${vote.id}/visibility`, {
      method: "PATCH",
      body: JSON.stringify({ visibility: "public", publicDetailLevel: "outcome_only" }),
    });
    expect(visRes.status).toBe(200);

    const publicRes = await callAnon(`/api/v1/votes/${vote.slug}`);
    expect(publicRes.status).toBe(200);
    const publicBody = (await publicRes.json()) as { vote: { result: { outcome: string; counts?: unknown } } };
    expect(publicBody.vote.result.outcome).toBeTruthy();
    expect(publicBody.vote.result.counts).toBeUndefined();

    const listRes = await callAnon("/api/v1/votes");
    const listBody = (await listRes.json()) as { votes: Array<{ slug: string }> };
    expect(listBody.votes.some((v) => v.slug === vote.slug)).toBe(true);
  });

  it("GET /api/v1/me/votes returns the caller's own ballot history", async () => {
    const wgId = await insertWorkingGroup("MyVotes WG", "myvotes-wg");
    const voterId = await insertMemberUser("F");
    await insertWgMembership(wgId, voterId);
    const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "My Vote History Test",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: wgId,
        thresholdType: "simple_majority",
        closesAt,
      }),
    });
    const { vote } = (await createRes.json()) as { vote: { id: string } };

    const token = await createMemberSession(env.DB, voterId, "my-votes-token");
    await call(token, `/api/v1/portal/votes/${vote.id}/ballots`, {
      method: "POST",
      body: JSON.stringify({ choice: "in_favor" }),
    });

    const res = await call(token, "/api/v1/me/votes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { votes: Array<{ voteId: string; choice: string }> };
    expect(body.votes).toHaveLength(1);
    expect(body.votes[0].voteId).toBe(vote.id);
    expect(body.votes[0].choice).toBe("in_favor");
  });

  it("RSS feed responds with XML for public votes", async () => {
    const res = await callAnon("/api/v1/votes/feed.rss");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("rss");
    const text = await res.text();
    expect(text).toContain("<rss");
  });
});
