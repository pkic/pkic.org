import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { runVotesDueWork } from "../functions/_lib/services/votes-scheduled-jobs";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import {
  REPRESENTATIVE_ROLE_IDS,
  assignRepresentativeRole,
  insertOrgRepresentative,
  insertOrganization,
} from "./helpers/membership";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function createPrimaryContact(name: string) {
  const organizationId = await insertOrganization(env.DB, name);
  const representative = await insertOrgRepresentative(env.DB, { organizationId, category: "A" });
  await assignRepresentativeRole(
    env.DB,
    representative.memberId,
    representative.userId,
    REPRESENTATIVE_ROLE_IDS.primaryContact,
  );
  return representative;
}

describe("durable forum vote delegate notification intents", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
    );
    adminToken = await createAdminSession(env.DB, admin.id, `vote-notification-admin-${crypto.randomUUID()}`);
  });

  it("drains the event-time recipient snapshot after an immediately open vote has already closed", async () => {
    const primary = await createPrimaryContact("Durable Notification Org");
    const createResponse = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Short Lived Forum Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(createResponse.status).toBe(200);
    const { vote } = (await createResponse.json()) as { vote: { id: string } };

    const [intent] = await queryAll<{
      delegate_user_id: string;
      recipient_email: string;
      queued_outbox_id: string | null;
    }>(
      env.DB,
      `SELECT delegate_user_id, recipient_email, queued_outbox_id
       FROM vote_delegate_notification_intents
       WHERE vote_id = ? AND round = 1 AND organization_id = ?`,
      vote.id,
      primary.organizationId,
    );
    expect(intent).toMatchObject({ delegate_user_id: primary.userId, queued_outbox_id: null });

    await env.DB.prepare("UPDATE votes SET closes_at = datetime('now', '-1 second') WHERE id = ?").bind(vote.id).run();
    const result = await runVotesDueWork(env.DB, env as any);
    expect(result).toMatchObject({ closed: 1, delegateNoticesQueued: 1 });
    expect(await queryAll(env.DB, "SELECT status FROM votes WHERE id = ?", vote.id)).toEqual([{ status: "closed" }]);
    expect(
      await queryAll(
        env.DB,
        `SELECT recipient_user_id, recipient_email
         FROM email_outbox
         WHERE template_key = 'forum-vote-delegate-notify'`,
      ),
    ).toEqual([{ recipient_user_id: primary.userId, recipient_email: intent.recipient_email }]);
  });

  it("rolls back a scheduled opening when its recipient snapshot fails, then retries atomically", async () => {
    await createPrimaryContact("Atomic Notification Org");
    const createResponse = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Atomic Scheduled Forum Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        opensAt: new Date(Date.now() + 60_000).toISOString(),
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(createResponse.status).toBe(200);
    const { vote } = (await createResponse.json()) as { vote: { id: string } };
    await env.DB.prepare("UPDATE votes SET opens_at = datetime('now', '-1 second') WHERE id = ?").bind(vote.id).run();
    await env.DB.prepare(
      `CREATE TRIGGER fail_vote_notification_intent
       BEFORE INSERT ON vote_delegate_notification_intents
       BEGIN
         SELECT RAISE(ABORT, 'forced vote notification intent failure');
       END`,
    ).run();

    try {
      await expect(runVotesDueWork(env.DB, env as any)).rejects.toThrow("forced vote notification intent failure");
      expect(await queryAll(env.DB, "SELECT status FROM votes WHERE id = ?", vote.id)).toEqual([
        { status: "scheduled" },
      ]);
      expect(
        await queryAll(
          env.DB,
          "SELECT id FROM audit_log WHERE action = 'vote_opened_automatically' AND entity_id = ?",
          vote.id,
        ),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_vote_notification_intent").run();
    }

    const retried = await runVotesDueWork(env.DB, env as any);
    expect(retried).toMatchObject({ opened: 1, delegateNoticesQueued: 1 });
    expect(
      await queryAll(env.DB, "SELECT vote_id FROM vote_delegate_notification_intents WHERE vote_id = ?", vote.id),
    ).toHaveLength(1);
  });

  it("falls back to an active primary contact when the voting delegate is expired, inactive, or removed", async () => {
    const expiredPrimary = await createPrimaryContact("Expired Delegate Org");
    const expiredDelegate = await insertOrgRepresentative(env.DB, {
      organizationId: expiredPrimary.organizationId,
      category: "A",
    });
    await assignRepresentativeRole(
      env.DB,
      expiredPrimary.memberId,
      expiredDelegate.userId,
      REPRESENTATIVE_ROLE_IDS.votingDelegate,
    );
    await env.DB.prepare(
      `UPDATE user_roles SET expires_at = datetime('now', '-1 minute')
       WHERE context_type = 'organization' AND context_id = ? AND role_id = ?`,
    )
      .bind(expiredPrimary.memberId, REPRESENTATIVE_ROLE_IDS.votingDelegate)
      .run();

    const inactivePrimary = await createPrimaryContact("Inactive Delegate Org");
    const inactiveDelegate = await insertOrgRepresentative(env.DB, {
      organizationId: inactivePrimary.organizationId,
      category: "A",
    });
    await assignRepresentativeRole(
      env.DB,
      inactivePrimary.memberId,
      inactiveDelegate.userId,
      REPRESENTATIVE_ROLE_IDS.votingDelegate,
    );
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(inactiveDelegate.userId).run();

    const removedPrimary = await createPrimaryContact("Removed Delegate Org");
    const removedDelegate = await insertOrgRepresentative(env.DB, {
      organizationId: removedPrimary.organizationId,
      category: "A",
    });
    await assignRepresentativeRole(
      env.DB,
      removedPrimary.memberId,
      removedDelegate.userId,
      REPRESENTATIVE_ROLE_IDS.votingDelegate,
    );
    await env.DB.prepare(
      "UPDATE organization_representatives SET left_at = joined_at WHERE member_id = ? AND user_id = ?",
    )
      .bind(removedPrimary.memberId, removedDelegate.userId)
      .run();

    const createResponse = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Delegate Fallback Forum Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    const { vote } = (await createResponse.json()) as { vote: { id: string } };
    expect(
      await queryAll(
        env.DB,
        `SELECT organization_id, delegate_user_id
         FROM vote_delegate_notification_intents
         WHERE vote_id = ? AND organization_id IN (?, ?, ?)
         ORDER BY organization_id`,
        vote.id,
        expiredPrimary.organizationId,
        inactivePrimary.organizationId,
        removedPrimary.organizationId,
      ),
    ).toEqual(
      [
        { organization_id: expiredPrimary.organizationId, delegate_user_id: expiredPrimary.userId },
        { organization_id: inactivePrimary.organizationId, delegate_user_id: inactivePrimary.userId },
        { organization_id: removedPrimary.organizationId, delegate_user_id: removedPrimary.userId },
      ].sort((a, b) => a.organization_id.localeCompare(b.organization_id)),
    );
  });

  it("keeps the opening-time delegate snapshot after the organization appoints a replacement", async () => {
    const original = await createPrimaryContact("Delegate Replacement Org");
    await assignRepresentativeRole(env.DB, original.memberId, original.userId, REPRESENTATIVE_ROLE_IDS.votingDelegate);
    const createResponse = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Opening-Time Delegate Forum Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    const { vote } = (await createResponse.json()) as { vote: { id: string } };
    const replacement = await insertOrgRepresentative(env.DB, {
      organizationId: original.organizationId,
      category: "A",
    });
    await assignRepresentativeRole(
      env.DB,
      original.memberId,
      replacement.userId,
      REPRESENTATIVE_ROLE_IDS.votingDelegate,
    );

    const result = await runVotesDueWork(env.DB, env as any);
    expect(result.delegateNoticesQueued).toBe(1);
    expect(
      await queryAll(
        env.DB,
        `SELECT recipient_user_id
         FROM email_outbox
         WHERE template_key = 'forum-vote-delegate-notify'`,
      ),
    ).toEqual([{ recipient_user_id: original.userId }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT delegate_user_id FROM vote_delegate_notification_intents WHERE vote_id = ?",
        vote.id,
      ),
    ).toEqual([{ delegate_user_id: original.userId }]);
  });

  it("snapshots only member organizations eligible for the vote", async () => {
    const eligible = await createPrimaryContact("Eligible Category A Org");
    const ineligibleOrganizationId = await insertOrganization(env.DB, "Ineligible Category B Org");
    const ineligible = await insertOrgRepresentative(env.DB, {
      organizationId: ineligibleOrganizationId,
      category: "B",
    });
    await assignRepresentativeRole(
      env.DB,
      ineligible.memberId,
      ineligible.userId,
      REPRESENTATIVE_ROLE_IDS.primaryContact,
    );

    const response = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Category A Forum Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        eligibleCategories: ["A"],
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(response.status).toBe(200);
    const { vote } = (await response.json()) as { vote: { id: string } };
    expect(
      await queryAll(
        env.DB,
        `SELECT organization_id
         FROM vote_delegate_notification_intents
         WHERE vote_id = ? AND organization_id IN (?, ?)`,
        vote.id,
        eligible.organizationId,
        ineligible.organizationId,
      ),
    ).toEqual([{ organization_id: eligible.organizationId }]);
  });

  it("atomically retries when marking the durable intent fails after preparing its outbox row", async () => {
    await createPrimaryContact("Queue Rollback Org");
    const response = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Queue Rollback Forum Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    const { vote } = (await response.json()) as { vote: { id: string } };
    await env.DB.prepare(
      `CREATE TRIGGER fail_vote_notification_queue_mark
       BEFORE UPDATE OF queued_outbox_id ON vote_delegate_notification_intents
       BEGIN
         SELECT RAISE(ABORT, 'forced vote notification queue-mark failure');
       END`,
    ).run();

    try {
      await expect(runVotesDueWork(env.DB, env as any)).rejects.toThrow("forced vote notification queue-mark failure");
      expect(
        await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'forum-vote-delegate-notify'"),
      ).toHaveLength(0);
      expect(
        await queryAll(
          env.DB,
          "SELECT queued_outbox_id FROM vote_delegate_notification_intents WHERE vote_id = ?",
          vote.id,
        ),
      ).toEqual([{ queued_outbox_id: null }]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_vote_notification_queue_mark").run();
    }

    const retry = await runVotesDueWork(env.DB, env as any);
    expect(retry.delegateNoticesQueued).toBe(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'forum-vote-delegate-notify'"),
    ).toHaveLength(1);
  });

  it("leaves the durable intent pending under a low D1 budget and drains it within a measured budget", async () => {
    await createPrimaryContact("Budgeted Notification Org");
    await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Budgeted Notification Forum Motion",
        voteType: "motion",
        scopeType: "forum",
        thresholdType: "simple_majority",
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });

    const insufficient = createD1QueryBudgetedDatabase(env.DB, 2);
    const deferred = await runVotesDueWork(insufficient.db, env as any, 50, insufficient.budget);
    expect(deferred.delegateNoticesQueued).toBe(0);
    expect(insufficient.budget.usedQueries()).toBe(0);

    const sufficient = createD1QueryBudgetedDatabase(env.DB, 3);
    const drained = await runVotesDueWork(sufficient.db, env as any, 50, sufficient.budget);
    expect(drained.delegateNoticesQueued).toBe(1);
    expect(sufficient.budget.usedQueries()).toBeLessThanOrEqual(3);
  });

  it("does not create forum delegate intents for working-group votes", async () => {
    await createPrimaryContact("Non-Forum Control Org");
    const workingGroupId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO working_groups
         (id, name, slug, min_endorsers_for_ballot, active, created_at, updated_at)
       VALUES (?, 'Notification Control WG', ?, 1, 1, datetime('now'), datetime('now'))`,
    )
      .bind(workingGroupId, `notification-control-${workingGroupId}`)
      .run();
    const response = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Working Group Notification Control",
        voteType: "motion",
        scopeType: "working_group",
        scopeId: workingGroupId,
        thresholdType: "simple_majority",
        closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(response.status).toBe(200);
    const { vote } = (await response.json()) as { vote: { id: string } };
    expect(
      await queryAll(env.DB, "SELECT vote_id FROM vote_delegate_notification_intents WHERE vote_id = ?", vote.id),
    ).toHaveLength(0);
  });

  it("creates the same durable intent for admin and endorsement proposal conversions", async () => {
    await env.DB.prepare("UPDATE membership_settings SET forum_vote_min_endorsers = 2 WHERE id = 'default'").run();
    const primary = await createPrimaryContact("Proposal Conversion Delegate Org");
    const proposer = await insertOrgRepresentative(env.DB, { category: "A" });
    const proposerToken = await createMemberSession(env.DB, proposer.userId, "forum-proposal-admin-conversion");

    const submit = (title: string) =>
      call(proposerToken, "/api/v1/portal/vote-proposals", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: "Verify the proposal conversion notification boundary.",
          voteType: "motion",
          scopeType: "forum",
        }),
      });
    const adminProposalResponse = await submit("Admin Converted Forum Proposal");
    expect(adminProposalResponse.status).toBe(200);
    const { proposal: adminProposal } = (await adminProposalResponse.json()) as { proposal: { id: string } };
    const approvalResponse = await call(adminToken, `/api/v1/admin/vote-proposals/${adminProposal.id}/approve`, {
      method: "POST",
    });
    expect(approvalResponse.status).toBe(200);
    const { convertedVote: adminVote } = (await approvalResponse.json()) as { convertedVote: { id: string } };

    const endorsementProposalResponse = await submit("Endorsement Converted Forum Proposal");
    const { proposal: endorsementProposal } = (await endorsementProposalResponse.json()) as {
      proposal: { id: string };
    };
    let endorsementVoteId: string | null = null;
    for (const suffix of ["one", "two"]) {
      const endorser = await insertOrgRepresentative(env.DB, { category: "A" });
      const token = await createMemberSession(env.DB, endorser.userId, `forum-endorser-${suffix}`);
      const response = await call(token, `/api/v1/portal/vote-proposals/${endorsementProposal.id}/endorse`, {
        method: "POST",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { convertedVote: { id: string } | null };
      endorsementVoteId = body.convertedVote?.id ?? endorsementVoteId;
    }
    if (!endorsementVoteId) throw new Error("Expected the second endorsement to convert the proposal");

    expect(
      await queryAll(
        env.DB,
        `SELECT vote_id, organization_id, delegate_user_id
         FROM vote_delegate_notification_intents
         WHERE vote_id IN (?, ?) AND organization_id = ?
         ORDER BY vote_id`,
        adminVote.id,
        endorsementVoteId,
        primary.organizationId,
      ),
    ).toEqual(
      [adminVote.id, endorsementVoteId].sort().map((voteId) => ({
        vote_id: voteId,
        organization_id: primary.organizationId,
        delegate_user_id: primary.userId,
      })),
    );
  });
});
