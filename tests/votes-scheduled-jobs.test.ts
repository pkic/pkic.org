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
      await queryAll(env.DB, "SELECT vote_id FROM vote_notification_deliveries WHERE vote_id = ?", vote.id),
    ).toHaveLength(1);
  });

  it("does nothing when no votes are due", async () => {
    const result = await runVotesDueWork(env.DB, env as any);
    expect(result).toEqual({ opened: 0, closed: 0, roundsAdvanced: 0, delegateNoticesQueued: 0 });
  });
});
