/**
 * votes-scheduled-jobs.test.ts
 *
 * runVotesDueWork (functions/_lib/services/votes-scheduled-jobs.ts) — the
 * forum-vote-delegate-notify email queueing that fires when a scheduled
 * vote opens. Mirrors votes.test.ts's admin-vote-creation +
 * setOrgContacts/insertMemberUser setup for a forum-scoped delegate.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import {
  seedOrganizationAggregate,
  addRepresentative,
  assignRepresentativeRole,
  REPRESENTATIVE_ROLE_IDS,
} from "./helpers/membership";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { isIndividualMembershipCategory } from "../assets/shared/schemas/membership-categories";
import { runVotesDueWork } from "../functions/_lib/services/votes-scheduled-jobs";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import { gateBatchGroup } from "./helpers/d1-batch-gate";

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

async function setOrgContacts(orgId: string, primaryContactUserId: string): Promise<void> {
  const memberId = await seedOrganizationAggregate(env.DB, orgId);
  await assignRepresentativeRole(env.DB, memberId, primaryContactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
}

async function insertMemberUser(category: string, organizationId: string | null = null): Promise<string> {
  userCounter += 1;
  const userId = await insertUser(`due-work-voter-${userCounter}@example.test`);
  if (isIndividualMembershipCategory(category)) {
    const { statements } = buildCreateIndividualMemberStatements(env.DB, userId, category, new Date().toISOString());
    await env.DB.batch(statements);
  } else {
    const orgId = organizationId ?? (await insertOrganization(`Due Work Voter Org ${crypto.randomUUID()}`));
    const memberId = await seedOrganizationAggregate(env.DB, orgId, category);
    await addRepresentative(env.DB, memberId, userId);
  }
  return userId;
}

describe("Votes due-work (functions/_lib/services/votes-scheduled-jobs.ts)", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-votes-due-work-token");
  });

  it("PR #1 review §9.1: opening a scheduled forum vote enqueues (does not synchronously send) forum-vote-delegate-notify to the resolved delegate", async () => {
    const orgId = await insertOrganization("Due Work Org");
    const primaryUserId = await insertMemberUser("A", orgId);
    await setOrgContacts(orgId, primaryUserId);

    const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Scheduled Forum Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        // Created in the future so it starts 'scheduled', then backdated
        // below to force it due — mirrors votes.test.ts's closes_at
        // backdate pattern for testing closeDueVotes.
        opensAt: new Date(Date.now() + 60_000).toISOString(),
        closesAt,
      }),
    });
    expect(createRes.status).toBe(200);
    const { vote } = (await createRes.json()) as { vote: { id: string; status: string } };
    expect(vote.status).toBe("scheduled");

    await env.DB.prepare("UPDATE votes SET opens_at = datetime('now', '-1 second') WHERE id = ?").bind(vote.id).run();

    const result = await runVotesDueWork(env.DB, env as any);
    expect(result.opened).toBe(1);
    expect(result.delegateNoticesQueued).toBe(1);

    const openedRows = await queryAll<{ status: string }>(env.DB, "SELECT status FROM votes WHERE id = ?", vote.id);
    expect(openedRows[0].status).toBe("open");

    const primaryUserRows = await queryAll<{ email: string }>(
      env.DB,
      "SELECT email FROM users WHERE id = ?",
      primaryUserId,
    );

    const outboxRows = await queryAll<{ status: string; recipient_email: string }>(
      env.DB,
      "SELECT status, recipient_email FROM email_outbox WHERE template_key = 'forum-vote-delegate-notify'",
    );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].recipient_email).toBe(primaryUserRows[0].email);
    // Enqueue only — the shared bounded outbox processor owns delivery, not
    // this loop (PR #1 review §9.1).
    expect(outboxRows[0].status).toBe("queued");

    const second = await runVotesDueWork(env.DB, env as any);
    expect(second.delegateNoticesQueued).toBe(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'forum-vote-delegate-notify'"),
    ).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT vote_id FROM vote_delegate_notification_intents WHERE vote_id = ?", vote.id),
    ).toHaveLength(1);
  });

  it("does nothing when no votes are due", async () => {
    const result = await runVotesDueWork(env.DB, env as any);
    expect(result).toEqual({ opened: 0, closed: 0, roundsAdvanced: 0, delegateNoticesQueued: 0 });
  });

  it("lets concurrent due-work runners close a vote once and write one closure audit", async () => {
    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Concurrent Closure Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(createRes.status).toBe(200);
    const { vote } = (await createRes.json()) as { vote: { id: string } };
    await env.DB.prepare("UPDATE votes SET closes_at = datetime('now', '-1 second') WHERE id = ?").bind(vote.id).run();

    const results = await Promise.all([runVotesDueWork(env.DB, env as any), runVotesDueWork(env.DB, env as any)]);

    expect(results.reduce((total, result) => total + result.closed, 0)).toBe(1);
    expect(await queryAll(env.DB, "SELECT status FROM votes WHERE id = ?", vote.id)).toEqual([{ status: "closed" }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'vote_closed_automatically' AND entity_id = ?",
        vote.id,
      ),
    ).toHaveLength(1);
  });

  it("rolls back a failed finalization and recovers after the close lease expires", async () => {
    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Recoverable Closure Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(createRes.status).toBe(200);
    const { vote } = (await createRes.json()) as { vote: { id: string } };
    await env.DB.prepare("UPDATE votes SET closes_at = datetime('now', '-1 second') WHERE id = ?").bind(vote.id).run();
    await env.DB.prepare(
      `CREATE TRIGGER fail_vote_closure_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'vote_closed_automatically'
       BEGIN
         SELECT RAISE(ABORT, 'forced vote closure audit failure');
       END`,
    ).run();

    try {
      await expect(runVotesDueWork(env.DB, env as any)).rejects.toThrow("forced vote closure audit failure");
      const [claimed] = await queryAll<{
        status: string;
        transition_revision: number;
        transition_processing_token: string | null;
      }>(env.DB, "SELECT status, transition_revision, transition_processing_token FROM votes WHERE id = ?", vote.id);
      expect(claimed).toMatchObject({ status: "open", transition_revision: 1 });
      expect(claimed.transition_processing_token).not.toBeNull();
      expect(
        await queryAll(
          env.DB,
          "SELECT id FROM audit_log WHERE action = 'vote_closed_automatically' AND entity_id = ?",
          vote.id,
        ),
      ).toHaveLength(0);

      await env.DB.prepare("UPDATE votes SET transition_lease_expires_at = datetime('now', '-1 second') WHERE id = ?")
        .bind(vote.id)
        .run();
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_vote_closure_audit").run();
    }

    const recovered = await runVotesDueWork(env.DB, env as any);
    expect(recovered.closed).toBe(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT status, transition_revision, transition_processing_token FROM votes WHERE id = ?",
        vote.id,
      ),
    ).toEqual([{ status: "closed", transition_revision: 3, transition_processing_token: null }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'vote_closed_automatically' AND entity_id = ?",
        vote.id,
      ),
    ).toHaveLength(1);
  });

  it("rolls back candidate elimination when election round advancement fails", async () => {
    const delegateOrgId = await insertOrganization("Election Round Delegate Org");
    const delegateUserId = await insertMemberUser("A", delegateOrgId);
    await setOrgContacts(delegateOrgId, delegateUserId);
    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Recoverable Election Round",
        voteType: "election",
        scopeType: "forum",
        thresholdType: "successive_elimination",
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        candidates: [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }],
      }),
    });
    expect(createRes.status).toBe(200);
    const { vote } = (await createRes.json()) as { vote: { id: string } };
    const candidates = await queryAll<{ id: string; candidate_name: string }>(
      env.DB,
      "SELECT id, candidate_name FROM vote_candidates WHERE vote_id = ? ORDER BY sort_order, id",
      vote.id,
    );
    const candidateId = (name: string) => candidates.find((candidate) => candidate.candidate_name === name)!.id;
    const choices = [
      candidateId("Alpha"),
      candidateId("Alpha"),
      candidateId("Beta"),
      candidateId("Beta"),
      candidateId("Gamma"),
    ];
    for (let index = 0; index < choices.length; index += 1) {
      const userId = await insertUser(`election-rollback-${index}@example.test`);
      await env.DB.prepare(
        `INSERT INTO vote_ballots
           (id, vote_id, user_id, organization_id, choice, round, submitted_at, ip_hash)
         VALUES (?, ?, ?, NULL, ?, 1, ?, NULL)`,
      )
        .bind(crypto.randomUUID(), vote.id, userId, choices[index], new Date().toISOString())
        .run();
    }
    await env.DB.prepare("UPDATE votes SET closes_at = datetime('now', '-1 second') WHERE id = ?").bind(vote.id).run();
    await env.DB.prepare(
      `CREATE TRIGGER fail_vote_round_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'vote_round_advanced_automatically'
       BEGIN
         SELECT RAISE(ABORT, 'forced vote round audit failure');
       END`,
    ).run();

    try {
      await expect(runVotesDueWork(env.DB, env as any)).rejects.toThrow("forced vote round audit failure");
      expect(
        await queryAll(env.DB, "SELECT eliminated_round FROM vote_candidates WHERE id = ?", candidateId("Gamma")),
      ).toEqual([{ eliminated_round: null }]);
      expect(await queryAll(env.DB, "SELECT status, current_round FROM votes WHERE id = ?", vote.id)).toEqual([
        { status: "open", current_round: 1 },
      ]);
      expect(
        await queryAll(
          env.DB,
          "SELECT round FROM vote_delegate_notification_intents WHERE vote_id = ? AND round = 2",
          vote.id,
        ),
      ).toHaveLength(0);
      await env.DB.prepare("UPDATE votes SET transition_lease_expires_at = datetime('now', '-1 second') WHERE id = ?")
        .bind(vote.id)
        .run();
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_vote_round_audit").run();
    }

    const recovered = await runVotesDueWork(env.DB, env as any);
    expect(recovered.roundsAdvanced).toBe(1);
    expect(
      await queryAll(env.DB, "SELECT eliminated_round FROM vote_candidates WHERE id = ?", candidateId("Gamma")),
    ).toEqual([{ eliminated_round: 1 }]);
    expect(await queryAll(env.DB, "SELECT status, current_round FROM votes WHERE id = ?", vote.id)).toEqual([
      { status: "open", current_round: 2 },
    ]);
    expect(
      await queryAll(
        env.DB,
        `SELECT round, organization_id, delegate_user_id
         FROM vote_delegate_notification_intents
         WHERE vote_id = ? AND round = 2`,
        vote.id,
      ),
    ).toEqual([{ round: 2, organization_id: delegateOrgId, delegate_user_id: delegateUserId }]);
  });

  it("defers the second closure under a low D1 budget and drains it on the next pass", async () => {
    const voteIds: string[] = [];
    for (const title of ["Budgeted Closure One", "Budgeted Closure Two"]) {
      const createRes = await call(adminToken, "/api/v1/admin/votes", {
        method: "POST",
        body: JSON.stringify({
          title,
          voteType: "motion",
          scopeType: "forum",
          thresholdType: "simple_majority",
          closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(createRes.status).toBe(200);
      const { vote } = (await createRes.json()) as { vote: { id: string } };
      voteIds.push(vote.id);
    }
    await env.DB.prepare("UPDATE votes SET closes_at = datetime('now', '-1 second') WHERE id IN (?, ?)")
      .bind(...voteIds)
      .run();

    const budgeted = createD1QueryBudgetedDatabase(env.DB, 8);
    const first = await runVotesDueWork(budgeted.db, env as any, 500, budgeted.budget);
    expect(first.closed).toBe(1);
    expect(budgeted.budget.usedQueries()).toBeLessThanOrEqual(8);
    expect(
      await queryAll(env.DB, "SELECT id FROM votes WHERE status = 'open' AND closes_at <= datetime('now')"),
    ).toHaveLength(1);

    const second = await runVotesDueWork(env.DB, env as any, 500);
    expect(second.closed).toBe(1);
    expect(await queryAll(env.DB, "SELECT id FROM votes WHERE status = 'closed'")).toHaveLength(2);
  });

  it("keeps concurrent opening runners' delegate notification queue idempotent", async () => {
    const orgId = await insertOrganization("Concurrent Notification Org");
    const primaryUserId = await insertMemberUser("A", orgId);
    await setOrgContacts(orgId, primaryUserId);

    const createRes = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Concurrent Notification Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        opensAt: new Date(Date.now() + 60_000).toISOString(),
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(createRes.status).toBe(200);
    const { vote } = (await createRes.json()) as { vote: { id: string } };
    await env.DB.prepare("UPDATE votes SET opens_at = datetime('now', '-1 second') WHERE id = ?").bind(vote.id).run();

    const concurrentDb = gateBatchGroup(env.DB, 2);
    const results = await Promise.all([
      runVotesDueWork(concurrentDb, env as any),
      runVotesDueWork(concurrentDb, env as any),
    ]);

    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'forum-vote-delegate-notify'"),
    ).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT vote_id FROM vote_delegate_notification_intents WHERE vote_id = ? AND round = 1",
        vote.id,
      ),
    ).toHaveLength(1);
    expect(results.reduce((total, result) => total + result.delegateNoticesQueued, 0)).toBe(1);
    const retry = await runVotesDueWork(env.DB, env as any);
    expect(retry.delegateNoticesQueued).toBe(0);
  });
});
