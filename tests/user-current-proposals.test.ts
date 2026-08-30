import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { currentUserProposalsListResponseSchema } from "../assets/shared/schemas/current-user-proposals";
import {
  buildCurrentUserProposalsPageQuery,
  listCurrentUserProposals,
} from "../functions/_lib/services/proposal-current-user-read-model";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { insertIndividualMember, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function insertEvent(slug?: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
     VALUES (?, ?, 'A conference', 'UTC', 'invite_or_open', 5, '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(id, slug ?? `current-proposals-${crypto.randomUUID()}`)
    .run();
  return id;
}

async function insertProposal(
  eventId: string,
  proposerUserId: string,
  overrides: { title?: string; status?: string; updatedAt?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO session_proposals
       (id, event_id, proposer_user_id, status, proposal_type, title, abstract, manage_link_secret, submitted_at, updated_at)
     VALUES (?, ?, ?, ?, 'talk', ?, 'An abstract', ?, ?, ?)`,
  )
    .bind(
      id,
      eventId,
      proposerUserId,
      overrides.status ?? "submitted",
      overrides.title ?? "A great talk",
      crypto.randomUUID(),
      overrides.updatedAt ?? "2027-01-01T00:00:00.000Z",
      overrides.updatedAt ?? "2027-01-01T00:00:00.000Z",
    )
    .run();
  await addProposalSpeaker(id, proposerUserId, "proposer");
  return id;
}

async function addProposalSpeaker(proposalId: string, userId: string, role: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, created_at)
     VALUES (?, ?, ?, ?, 'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(crypto.randomUUID(), proposalId, userId, role)
    .run();
}

function getAs(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(resetDb);

describe("GET /api/v1/users/current/proposals", () => {
  it("rejects an unauthenticated caller", async () => {
    expect((await callApi(env, "/api/v1/users/current/proposals")).status).toBe(401);
  });

  it("allows a staff-only identity with no member capacity to read its own proposals", async () => {
    const staffOnlyUserId = await insertUser(env.DB, `current-proposals-staff-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(staffOnlyUserId).run();
    const eventId = await insertEvent();
    const proposalId = await insertProposal(eventId, staffOnlyUserId);
    const token = await createMemberSession(env.DB, staffOnlyUserId, `current-proposals-staff-${crypto.randomUUID()}`);

    const response = await getAs(token, "/api/v1/users/current/proposals");
    expect(response.status, await response.clone().text()).toBe(200);
    const page = currentUserProposalsListResponseSchema.parse(await response.json());
    expect(page.proposals.map((p) => p.id)).toEqual([proposalId]);
    expect(page.proposals[0]!.role).toBe("submitter");
  });

  it("returns proposals by submitter role and by listed-speaker role, excludes unrelated proposals, and orders newest-updated first", async () => {
    const { userId: submitterId } = await insertIndividualMember(
      env.DB,
      "H6",
      `current-proposals-submitter-${crypto.randomUUID()}@example.test`,
    );
    const { userId: speakerId } = await insertIndividualMember(
      env.DB,
      "H6",
      `current-proposals-speaker-${crypto.randomUUID()}@example.test`,
    );
    const outsiderId = await insertUser(env.DB, `current-proposals-outsider-${crypto.randomUUID()}@example.test`);
    const eventId = await insertEvent();

    const submittedProposal = await insertProposal(eventId, submitterId, {
      title: "Submitted by me",
      updatedAt: "2027-01-01T00:00:00.000Z",
    });
    const speakingProposal = await insertProposal(eventId, outsiderId, {
      title: "I am a listed speaker",
      updatedAt: "2027-06-01T00:00:00.000Z",
    });
    await addProposalSpeaker(speakingProposal, speakerId, "co_speaker");
    // Unrelated to either caller — must never appear for them.
    await insertProposal(eventId, outsiderId, { title: "Not mine" });

    const submitterToken = await createMemberSession(
      env.DB,
      submitterId,
      `current-proposals-submitter-${crypto.randomUUID()}`,
    );
    const submitterResponse = await getAs(submitterToken, "/api/v1/users/current/proposals");
    const submitterPage = currentUserProposalsListResponseSchema.parse(await submitterResponse.json());
    expect(submitterPage.proposals.map((p) => p.id)).toEqual([submittedProposal]);
    expect(submitterPage.proposals[0]!.role).toBe("submitter");

    const speakerToken = await createMemberSession(
      env.DB,
      speakerId,
      `current-proposals-speaker-${crypto.randomUUID()}`,
    );
    const speakerResponse = await getAs(speakerToken, "/api/v1/users/current/proposals");
    const speakerPage = currentUserProposalsListResponseSchema.parse(await speakerResponse.json());
    expect(speakerPage.proposals.map((p) => p.id)).toEqual([speakingProposal]);
    expect(speakerPage.proposals[0]!.role).toBe("speaker");

    // Newest-updated first, across both roles for a caller with both.
    await addProposalSpeaker(speakingProposal, submitterId, "moderator");
    const combinedResponse = await getAs(submitterToken, "/api/v1/users/current/proposals");
    const combinedPage = currentUserProposalsListResponseSchema.parse(await combinedResponse.json());
    expect(combinedPage.proposals.map((p) => p.id)).toEqual([speakingProposal, submittedProposal]);
    expect(combinedPage.page.total).toBe(2);

    // Parity: the route is a thin wrapper over the service, not a second policy.
    const direct = await listCurrentUserProposals(env.DB, submitterId, { limit: 20, offset: 0 });
    expect(direct.proposals.map((p) => p.id)).toEqual([speakingProposal, submittedProposal]);
  });

  it("never serializes a token, manage link, or capability field", async () => {
    const { userId: submitterId } = await insertIndividualMember(
      env.DB,
      "H6",
      `current-proposals-safe-${crypto.randomUUID()}@example.test`,
    );
    const eventId = await insertEvent();
    await insertProposal(eventId, submitterId);
    const token = await createMemberSession(env.DB, submitterId, `current-proposals-safe-${crypto.randomUUID()}`);

    const response = await getAs(token, "/api/v1/users/current/proposals");
    const rawText = await response.text();
    const parsed = currentUserProposalsListResponseSchema.parse(JSON.parse(rawText));
    expect(parsed.proposals.length).toBeGreaterThan(0);

    const serializedKeys = rawText.toLowerCase();
    expect(serializedKeys).not.toMatch(/token/);
    expect(serializedKeys).not.toMatch(/manage[_-]?(link|url)/);
    expect(serializedKeys).not.toMatch(/capability/);
  });

  it("rejects pagination correctly", async () => {
    const { userId: submitterId } = await insertIndividualMember(
      env.DB,
      "H6",
      `current-proposals-page-${crypto.randomUUID()}@example.test`,
    );
    const eventId = await insertEvent();
    const first = await insertProposal(eventId, submitterId, { title: "First", updatedAt: "2027-01-01T00:00:00.000Z" });
    const second = await insertProposal(eventId, submitterId, {
      title: "Second",
      updatedAt: "2027-02-01T00:00:00.000Z",
    });
    const token = await createMemberSession(env.DB, submitterId, `current-proposals-page-${crypto.randomUUID()}`);

    const firstPage = currentUserProposalsListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/proposals?limit=1&offset=0")).json(),
    );
    expect(firstPage.proposals[0]!.id).toBe(second);
    expect(firstPage.page).toMatchObject({ limit: 1, offset: 0, total: 2, hasMore: true });
    const secondPage = currentUserProposalsListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/proposals?limit=1&offset=1")).json(),
    );
    expect(secondPage.proposals[0]!.id).toBe(first);
    expect(secondPage.page).toMatchObject({ limit: 1, offset: 1, total: 2, hasMore: false });
  });
});

describe("buildCurrentUserProposalsPageQuery D1 query plan", () => {
  beforeEach(resetDb);

  it("produces an executable EXPLAIN QUERY PLAN", async () => {
    const query = buildCurrentUserProposalsPageQuery("some-user-id", { limit: 50, offset: 0 });
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);
    const [pagePlan, countPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, query.limit, query.offset)
        .all(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...countBindings)
        .all(),
    ]);
    expect(pagePlan.results.length).toBeGreaterThan(0);
    expect(countPlan.results.length).toBeGreaterThan(0);
    // There is no index on session_proposals.proposer_user_id, so the direct
    // `sp.proposer_user_id = ?` branch is a table scan (SCAN sp below); the
    // EXISTS branch's correlated subquery uses the UNIQUE(proposal_id,
    // user_id) auto-index on proposal_speakers, the closest existing access
    // path. See the flagged gap in this query's owning module.
    const planText = JSON.stringify(pagePlan.results);
    expect(planText).toContain("SCAN sp");
    expect(planText).toContain("SEARCH ps USING COVERING INDEX sqlite_autoindex_proposal_speakers_2");
  });
});
