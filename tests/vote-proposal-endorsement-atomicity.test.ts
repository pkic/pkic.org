/**
 * P5-R01 / P5-R02 (Phase 5 remediation pass, open questions 4 and re-read
 * double-fault): endorseVoteProposal's endorsement insert and the guarded
 * proposal-to-vote conversion now run in one atomic db.batch() (P5-R01)
 * instead of the endorsement committing as its own separate statement
 * ahead of the conversion decision. And if the "lost race" re-read that
 * follows a 0-row guarded conversion attempt itself throws, the error the
 * caller sees now carries the proposal-scoped context instead of an opaque
 * re-read failure (P5-R02).
 *
 * Mirrors tests/votes.test.ts's setup helpers (insertWorkingGroup,
 * insertMemberUser, insertWgMembership) and calls the service function
 * directly rather than through the HTTP layer, since P5-R02 needs to
 * inject a DatabaseLike wrapper that fails on one specific query.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { seedOrganizationAggregate, addRepresentative } from "./helpers/membership";
import { isIndividualMembershipCategory } from "../assets/shared/schemas/membership-categories";
import { requireMemberFromRequest } from "../functions/_lib/auth/member";
import { endorseVoteProposal } from "../functions/_lib/services/votes";
import { isAppError } from "../functions/_lib/errors";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";

let userCounter = 0;

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, data_json, created_at, updated_at)
     VALUES (?, ?, ?, 'Test', 'Voter', NULL, datetime('now'), datetime('now'))`,
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

/** Mirrors tests/votes.test.ts's insertMemberUser exactly (individual vs. org-representative categories). */
async function insertMemberUser(category: string): Promise<string> {
  userCounter += 1;
  const userId = await insertUser(`atomicity-voter-${userCounter}@example.test`);
  if (isIndividualMembershipCategory(category)) {
    const { statements } = buildCreateIndividualMemberStatements(env.DB, userId, category, new Date().toISOString());
    await env.DB.batch(statements);
  } else {
    const orgId = await insertOrganization(`Atomicity Voter Org ${crypto.randomUUID()}`);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, category);
    await addRepresentative(env.DB, memberId, userId);
  }
  return userId;
}

async function insertWorkingGroup(name: string, slug: string, minEndorsers: number): Promise<string> {
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

async function insertOpenProposal(wgId: string, proposerId: string, title: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO vote_proposals
       (id, title, description, vote_type, scope_type, scope_id, proposed_by_user_id, status, created_at, updated_at)
     VALUES (?, ?, 'N/A', 'motion', 'working_group', ?, ?, 'open_for_endorsement', datetime('now'), datetime('now'))`,
  )
    .bind(id, title, wgId, proposerId)
    .run();
  return id;
}

/** Resolves a real AuthMember for `userId` via a genuine session, exactly as the route handler does. */
async function resolveMember(userId: string) {
  const token = await createMemberSession(env.DB, userId, `atomicity-token-${userId}`);
  const request = new Request("https://app.test/api/v1/portal/vote-proposals/x/endorse", {
    headers: { authorization: `Bearer ${token}` },
  });
  return requireMemberFromRequest(env.DB, request, env as any);
}

/**
 * Wraps the real D1 binding so every query is delegated to the real
 * underlying D1PreparedStatement unchanged, except one exact SQL text
 * match, which fails instead. Keeps a reference to the real (bound)
 * statement on every wrapper (`__real`) so `batch()` can unwrap back to
 * genuine D1PreparedStatement objects — the real D1 binding's batch()
 * rejects anything that isn't one of its own statement instances.
 */
function dbThrowingOn(failingSql: string, message: string): DatabaseLike {
  const normalizedTarget = failingSql.replace(/\s+/g, " ").trim();

  function wrapStatement(real: any, sql: string): StatementLike & { __real: unknown } {
    const isTarget = sql.replace(/\s+/g, " ").trim() === normalizedTarget;
    return {
      __real: real,
      bind(...values: unknown[]): StatementLike {
        return wrapStatement(real.bind(...values), sql);
      },
      async run<T>() {
        if (isTarget) throw new Error(message);
        return real.run() as Promise<{ success: boolean; meta: { changes: number } } & T>;
      },
      async all<T>() {
        if (isTarget) throw new Error(message);
        return real.all() as Promise<{ results: T[] }>;
      },
      async first<T>(columnName?: string) {
        if (isTarget) throw new Error(message);
        return real.first(columnName) as Promise<T | null>;
      },
    };
  }

  return {
    prepare(sql: string): StatementLike {
      return wrapStatement(env.DB.prepare(sql), sql);
    },
    batch: (statements: StatementLike[]) =>
      env.DB.batch(statements.map((s) => (s as StatementLike & { __real: any }).__real)),
  };
}

describe("endorseVoteProposal atomicity and error handling (P5-R01 / P5-R02)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("P5-R01: below-threshold endorsement (guarded conversion no-ops) still records the endorsement, bundled in the same atomic batch", async () => {
    const wgId = await insertWorkingGroup("Atomicity WG", "atomicity-wg", 5);
    const proposerId = await insertMemberUser("F");
    const endorserId = await insertMemberUser("F");
    await insertWgMembership(wgId, proposerId);
    await insertWgMembership(wgId, endorserId);
    const proposalId = await insertOpenProposal(wgId, proposerId, "Atomicity Below Threshold");

    const member = await resolveMember(endorserId);
    const result = await endorseVoteProposal(env.DB, member, proposalId);

    expect(result.convertedVote).toBeNull();
    expect(result.proposal.status).toBe("open_for_endorsement");

    const rows = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM vote_proposal_endorsements WHERE proposal_id = ? AND endorser_user_id = ?",
      proposalId,
      endorserId,
    );
    expect(rows).toHaveLength(1);
  });

  it("P5-R02: a re-read failure after a 0-row guarded conversion surfaces proposal-scoped context, not an opaque re-read error", async () => {
    const wgId = await insertWorkingGroup("Reread Failure WG", "reread-failure-wg", 5);
    const proposerId = await insertMemberUser("F");
    const endorserId = await insertMemberUser("F");
    await insertWgMembership(wgId, proposerId);
    await insertWgMembership(wgId, endorserId);
    const proposalId = await insertOpenProposal(wgId, proposerId, "Reread Failure Below Threshold");

    const member = await resolveMember(endorserId);
    // Below the WG's threshold of 5, so the guarded conversion in
    // insertEndorsementAndMaybeConvert inserts 0 rows and falls through to
    // resolveLostRaceVote's re-read — which this wrapped db makes fail.
    const failingDb = dbThrowingOn(
      "SELECT vote_id FROM vote_proposals WHERE id = ?",
      "simulated transient D1 error on the lost-race re-read",
    );

    await expect(endorseVoteProposal(failingDb, member, proposalId)).rejects.toSatisfy((error: unknown) => {
      if (!isAppError(error)) return false;
      expect(error.status).toBe(500);
      expect(error.code).toBe("VOTE_CONVERSION_STATUS_UNKNOWN");
      expect(error.details).toMatchObject({ proposalId });
      expect((error.details as { cause: string }).cause).toContain("simulated transient D1 error");
      return true;
    });
  });
});
