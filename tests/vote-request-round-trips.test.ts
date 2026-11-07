import { createGroup } from "../functions/_lib/services/groups";
import { verifyUserSessionToken } from "../functions/_lib/auth/user-session-token";
import { signMcpSessionToken } from "../functions/_lib/auth/mcp-session";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { createMcpOauthTestClient } from "./helpers/mcp-oauth";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import {
  TEST_GROUPS,
  authorizedRequest,
  createCanonicalVote,
  createOrganizationCapacity,
  joinVotingGroup,
  seedVotingAdmin,
} from "./helpers/voting";
import { groupVoteDetailResponseSchema } from "../assets/shared/schemas/group-votes";
import { groupVoteBallotsAuditResponseSchema } from "../assets/shared/schemas/group-vote-management";
import { currentUserVotesListResponseSchema } from "../assets/shared/schemas/votes";
import type { Env } from "../functions/_lib/types";

describe("complete vote request D1 budgets", () => {
  let admin: Awaited<ReturnType<typeof seedVotingAdmin>>;
  let capacity: Awaited<ReturnType<typeof createOrganizationCapacity>>;
  let token: string;
  let vote: Awaited<ReturnType<typeof createCanonicalVote>>;
  let path: string;

  beforeEach(async () => {
    await resetDb();
    admin = await seedVotingAdmin(env.DB);
    capacity = await createOrganizationCapacity(env.DB, { organizationName: "Synthetic voting organization" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    token = await createMemberSession(env.DB, capacity.userId, crypto.randomUUID(), undefined, capacity.identityId);
    vote = await createCanonicalVote(env.DB, admin.admin);
    path = `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}`;
  });

  function call(token: string, path: string, init?: RequestInit, environment: Env = env) {
    return callApi(environment, authorizedRequest(token, path, init), undefined, { maxRoundTrips: 1 });
  }
  function submit(choice: string, replacesBallotCastAt?: string | null, environment: Env = env) {
    return call(
      token,
      `${path}/ballots`,
      { method: "POST", body: JSON.stringify({ memberId: capacity.memberId, choice, replacesBallotCastAt }) },
      environment,
    );
  }
  async function detail() {
    const response = await call(token, path);
    expect(response.status, await response.clone().text()).toBe(200);
    return groupVoteDetailResponseSchema.parse(await response.json()).vote;
  }

  it("casts, reads recorded ballots, discovers a bounded page, and audits with one call each", async () => {
    expect((await submit("in_favor")).status).toBe(200);
    expect((await detail()).memberBallots?.[0].recorded).toMatchObject({ choice: "in_favor", castByYou: true });
    const [{ slug }] = await queryAll<{ slug: string }>(env.DB, "SELECT slug FROM groups WHERE id=?", TEST_GROUPS.pqc);
    expect((await call(token, `/api/v1/groups/${slug}/votes/${vote.id}`)).status).toBe(200);
    for (const offset of [0, 1]) {
      const response = await call(
        token,
        `/api/v1/users/current/votes?limit=1&offset=${offset}&q=${encodeURIComponent(vote.title)}`,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const result = currentUserVotesListResponseSchema.parse(await response.json());
      expect(result.page.total).toBe(1);
      expect(result.votes).toHaveLength(offset === 0 ? 1 : 0);
      if (offset === 0) expect(result.votes[0].memberBallots?.[0].recorded?.choice).toBe("in_favor");
    }
    for (const offset of [0, 1]) {
      const response = await call(
        admin.adminToken,
        `${path}/ballots?q=In%20favor&sort=-memberName&limit=1&offset=${offset}`,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const result = groupVoteBallotsAuditResponseSchema.parse(await response.json());
      expect(result.page.total).toBe(1);
      expect(result.ballots).toHaveLength(offset === 0 ? 1 : 0);
    }
  });

  it("refuses unseen and stale replacements without another diagnostic round trip", async () => {
    expect((await submit("in_favor")).status).toBe(200);
    const recorded = (await detail()).memberBallots![0].recorded!;
    for (const missing of [undefined, null]) {
      const response = await submit("opposed", missing);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "BALLOT_CHANGED" } });
    }
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(recorded.castAt));
    try {
      expect((await submit("opposed", recorded.castAt)).status).toBe(200);
      const stale = await submit("abstain", recorded.castAt);
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: { code: "BALLOT_CHANGED" } });
      expect(await queryAll(env.DB, "SELECT choice, updated_at FROM vote_ballots WHERE vote_id=?", vote.id)).toEqual([
        { choice: "opposed", updated_at: new Date(Date.parse(recorded.castAt) + 1).toISOString() },
      ]);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps candidate validation, replacement, and election hydration inside the request budget", async () => {
    vote = await createCanonicalVote(env.DB, admin.admin, {
      voteType: "election",
      candidates: [{ name: "Synthetic Candidate A" }, { name: "Synthetic Candidate B" }],
    });
    path = `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}`;
    const candidates = (await detail()).candidates!;
    expect((await submit(candidates[0].id)).status).toBe(200);
    const recorded = (await detail()).memberBallots![0].recorded!;
    await env.DB.prepare("UPDATE vote_candidates SET eliminated_round=1 WHERE id=?").bind(candidates[1].id).run();
    expect((await submit(candidates[1].id, recorded.castAt)).status).toBe(422);
    expect((await detail()).memberBallots![0].recorded).toEqual(recorded);
    const response = await call(admin.adminToken, `${path}/ballots?q=Synthetic%20Candidate%20A&sort=choice`);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(groupVoteBallotsAuditResponseSchema.parse(await response.json()).ballots[0].candidateName).toBe(
      "Synthetic Candidate A",
    );
  });

  it("preserves per-person replacements and refuses a Member selection", async () => {
    vote = await createCanonicalVote(env.DB, admin.admin, { electorateMode: "per_person" });
    path = `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}`;
    expect((await submit("in_favor")).status).toBe(422);
    for (const choice of ["in_favor", "opposed"]) {
      const response = await call(token, `${path}/ballots`, { method: "POST", body: JSON.stringify({ choice }) });
      expect(response.status, await response.clone().text()).toBe(200);
    }
    expect((await detail()).hasCastBallot).toBe(true);
    expect(await queryAll(env.DB, "SELECT member_id, choice FROM vote_ballots WHERE vote_id=?", vote.id)).toEqual([
      { member_id: null, choice: "opposed" },
    ]);
  });

  it("never borrows management from another group's matching slug", async () => {
    const shadow = await createGroup(env.DB, admin.admin, {
      typeKey: "working_group",
      name: "Synthetic shadow group",
      slug: TEST_GROUPS.pqc,
      visibility: "public",
      eligibilityMode: "open",
    });
    await grantGroupLeadershipCapacity(env.DB, shadow.id, capacity.userId);
    await env.DB.prepare("UPDATE groups SET visibility='public' WHERE id=?").bind(TEST_GROUPS.pqc).run();
    await env.DB.prepare("UPDATE group_memberships SET left_at=? WHERE user_id=? AND group_id=?")
      .bind(new Date().toISOString(), capacity.userId, TEST_GROUPS.pqc)
      .run();
    const response = await call(token, path);
    expect(response.status, await response.clone().text()).toBe(404);
    expect(await response.json()).not.toHaveProperty("vote");
    expect((await call(token, `${path}/ballots`)).status).toBe(403);
  });

  it("preserves a delegated leader's selected Member and exact group ceiling", async () => {
    const delegatedEnv = { ...env, INTERNAL_SIGNING_SECRET: "synthetic-oauth-vote-test-signing-secret-32-plus" };
    const leadership = await grantGroupLeadershipCapacity(env.DB, TEST_GROUPS.pqc, capacity.userId);
    const session = await createAdminSession(
      env.DB,
      capacity.userId,
      crypto.randomUUID(),
      delegatedEnv.INTERNAL_SIGNING_SECRET,
      leadership.identityId,
    );
    const { authorize } = createMcpOauthTestClient(delegatedEnv);
    const grant = await authorize(session, ["groups:write"], leadership.identityId);
    const verified = await verifyUserSessionToken(delegatedEnv.INTERNAL_SIGNING_SECRET, session);
    if (!verified.ok) throw new Error("Synthetic leader session must verify");
    const [{ email }] = await queryAll<{ email: string }>(
      env.DB,
      "SELECT email FROM users WHERE id=?",
      capacity.userId,
    );
    const forwardedToken = await signMcpSessionToken(delegatedEnv.INTERNAL_SIGNING_SECRET, {
      sub: capacity.userId,
      sid: verified.claims.sid,
      email,
      scopes: ["groups:write"],
      authorizationId: grant.authorizationId,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const delegated = (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("x-pkic-machine-auth", "mcp");
      return call(forwardedToken, url, { ...init, headers }, delegatedEnv);
    };
    const response = await delegated(path);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(groupVoteDetailResponseSchema.parse(await response.json()).vote.capabilities).toContain("manage");
    expect((await delegated(`${path}/ballots`)).status).toBe(200);
    const outside = await delegated(`/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}`);
    expect(outside.status).toBeGreaterThanOrEqual(400);
    expect(outside.status).toBeLessThan(500);
    const submission = await delegated(`${path}/ballots`, {
      method: "POST",
      body: JSON.stringify({ memberId: capacity.memberId, choice: "in_favor" }),
    });
    expect(submission.status).toBe(403);
    expect(await queryAll(env.DB, "SELECT id FROM vote_ballots WHERE vote_id=?", vote.id)).toEqual([]);
  });

  it.each(["identity", "session", "membership", "category"] as const)(
    "rechecks %s authority before the atomic batch writes",
    async (kind) => {
      const gate = gateNextBatch(env.DB);
      const pending = submit("in_favor", null, { ...env, DB: gate.db });
      await gate.reached;
      const now = new Date().toISOString();
      const changes = {
        identity: () =>
          env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(now, capacity.identityId).run(),
        session: () =>
          env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(now, capacity.userId).run(),
        membership: () =>
          env.DB.prepare("UPDATE group_memberships SET left_at=? WHERE user_id=? AND group_id=?")
            .bind(now, capacity.userId, TEST_GROUPS.pqc)
            .run(),
        category: () => env.DB.prepare("UPDATE membership_categories SET is_voting=0 WHERE code='A'").run(),
      };
      try {
        await changes[kind]();
      } finally {
        gate.release();
      }
      const response = await pending;
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(await queryAll(env.DB, "SELECT id FROM vote_ballots WHERE vote_id=?", vote.id)).toEqual([]);
    },
  );

  it.each(["scheduled", "closed"])("refuses a %s vote in one call", async (state) => {
    const now = Date.now();
    const opens = now + (state === "scheduled" ? 60_000 : -120_000);
    const closes = now + (state === "scheduled" ? 120_000 : -60_000);
    await env.DB.prepare("UPDATE votes SET opens_at=?, closes_at=? WHERE id=?")
      .bind(new Date(opens).toISOString(), new Date(closes).toISOString(), vote.id)
      .run();
    const response = await submit("in_favor");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "VOTE_NOT_OPEN" } });
    expect(await queryAll(env.DB, "SELECT id FROM vote_ballots WHERE vote_id=?", vote.id)).toEqual([]);
  });

  it("keeps identifiable audit rows private after a management grant is revoked", async () => {
    expect((await submit("in_favor")).status).toBe(200);
    expect((await call(token, `${path}/ballots`)).status).toBe(403);
    const gate = gateNextBatch(env.DB);
    const pending = call(admin.adminToken, `${path}/ballots`, undefined, { ...env, DB: gate.db });
    await gate.reached;
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), admin.adminId)
      .run();
    gate.release();
    const response = await pending;
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await response.json()).not.toHaveProperty("ballots");
  });
});
