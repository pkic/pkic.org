/**
 * Who may read a community profile, and who may vouch on one.
 *
 * These routes changed authority deliberately: the consortium's profiles are
 * an internal directory, so a signed-in member reads another member's record
 * without holding staff permission over user administration. The tests below
 * are the boundary — an ordinary member gets in, an unauthenticated caller
 * does not, and vouching stays a member's act rather than an administrator's.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import app from "../functions/router";
import { createMemberSession } from "./helpers/auth";
import { insertIndividualMember } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const NOW = () => new Date().toISOString();

function call(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    env as never,
    { passThroughOnException: () => undefined, waitUntil: () => undefined } as never,
  );
}

async function insertGroup(slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO groups (id, type_key, name, slug, active, created_at, updated_at)
     VALUES (?, 'working_group', ?, ?, 1, ?, ?)`,
  )
    .bind(id, slug, slug, NOW(), NOW())
    .run();
  return id;
}

async function joinGroup(groupId: string, m: { userId: string; memberId: string; identityId: string }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO group_memberships
       (id, group_id, user_id, identity_id, member_id, source, joined_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'staff', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), groupId, m.userId, m.identityId, m.memberId, NOW(), NOW(), NOW())
    .run();
}

async function claimSkill(userId: string, slug: string): Promise<string> {
  const skillId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO skills (id, slug, name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`)
    .bind(skillId, slug, slug, NOW(), NOW())
    .run();
  await env.DB.prepare(
    `INSERT INTO user_skills (id, user_id, skill_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, skillId, NOW(), NOW())
    .run();
  return skillId;
}

describe("community profile access", () => {
  beforeEach(resetDb);

  it("lets an ordinary member read another member's profile without staff permission", async () => {
    const subject = await insertIndividualMember(env.DB, "H6", "subject@example.test");
    const reader = await insertIndividualMember(env.DB, "H6", "reader@example.test");
    const token = await createMemberSession(env.DB, reader.userId, "reader-token");

    for (const path of ["skills", "standing", "availability", "participation"]) {
      const response = await call(token, `/api/v1/users/${subject.userId}/${path}`);
      // A member holds no `users:read`; the directory is not administration.
      expect(response.status, `${path} should be readable by a member`).toBe(200);
    }
  });

  it("refuses an unauthenticated reader", async () => {
    const subject = await insertIndividualMember(env.DB, "H6", "subject2@example.test");

    const response = await call(null, `/api/v1/users/${subject.userId}/skills`);

    // Members-only, not public — that is a later decision, not today's.
    expect([401, 403]).toContain(response.status);
  });

  it("lets a member vouch for a peer they share a group with", async () => {
    const subject = await insertIndividualMember(env.DB, "H6", "subject3@example.test");
    const peer = await insertIndividualMember(env.DB, "H6", "peer3@example.test");
    const group = await insertGroup("shared-group");
    await joinGroup(group, subject);
    await joinGroup(group, peer);
    const skillId = await claimSkill(subject.userId, "shared-skill");
    const token = await createMemberSession(env.DB, peer.userId, "peer-token");

    const response = await call(token, `/api/v1/users/${subject.userId}/skills/${skillId}/vouches`, {
      method: "POST",
      body: "{}",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { skills: { vouchCount: number; vouchedByViewer: boolean }[] };
    expect(body.skills[0]?.vouchCount).toBe(1);
    expect(body.skills[0]?.vouchedByViewer).toBe(true);
  });

  it("refuses a vouch from a member who shares no group", async () => {
    const subject = await insertIndividualMember(env.DB, "H6", "subject4@example.test");
    const stranger = await insertIndividualMember(env.DB, "H6", "stranger4@example.test");
    await joinGroup(await insertGroup("theirs-only"), subject);
    const skillId = await claimSkill(subject.userId, "unshared-skill");
    const token = await createMemberSession(env.DB, stranger.userId, "stranger-token");

    const response = await call(token, `/api/v1/users/${subject.userId}/skills/${skillId}/vouches`, {
      method: "POST",
      body: "{}",
    });

    // The rule that makes a vouch worth something survives the route change.
    expect(response.status).toBe(403);
  });

  it("refuses a vouch from an unauthenticated caller", async () => {
    const subject = await insertIndividualMember(env.DB, "H6", "subject5@example.test");
    const skillId = await claimSkill(subject.userId, "unauth-skill");

    const response = await call(null, `/api/v1/users/${subject.userId}/skills/${skillId}/vouches`, {
      method: "POST",
      body: "{}",
    });

    expect([401, 403]).toContain(response.status);
  });
});
