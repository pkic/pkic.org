import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptPendingIdentity } from "../functions/_lib/services/identities";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  REPRESENTATIVE_ROLE_IDS,
  addRepresentative,
  assignRepresentativeRole,
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function asUser(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return callApi(env, path, { ...init, headers });
}

async function inviteIdentity(): Promise<{
  identityId: string;
  invitedUserId: string;
  invitedToken: string;
}> {
  const organizationId = await insertOrganization(env.DB, "Invitation Lifecycle Organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  const contactUserId = await insertUser(env.DB, "contact@invitation-lifecycle.example");
  const contactIdentityId = await addRepresentative(env.DB, memberId, contactUserId);
  await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
  const contactToken = await createMemberSession(
    env.DB,
    contactUserId,
    "identity-invitation-contact-token",
    undefined,
    contactIdentityId,
  );
  const invitedUserId = await insertUser(env.DB, "invited@invitation-lifecycle.example");
  const response = await asUser(contactToken, `/api/v1/organizations/${organizationId}/identities`, {
    method: "POST",
    body: JSON.stringify({
      userReference: "existing_user",
      userId: invitedUserId,
      activation: { mode: "invitation" },
      showOnOrganizationProfile: true,
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const receipt = (await response.json()) as { identityId: string; state: string };
  expect(receipt.state).toBe("pending");
  return {
    identityId: receipt.identityId,
    invitedUserId,
    invitedToken: await createMemberSession(env.DB, invitedUserId, "pending-identity-session-token"),
  };
}

beforeEach(resetDb);

describe("identity invitation acceptance", () => {
  it("keeps a sign-in invitation capacity-only until the exact user accepts, then enrolls atomically", async () => {
    const { identityId, invitedUserId, invitedToken } = await inviteIdentity();

    const sessionBefore = await asUser(invitedToken, "/api/v1/auth/session");
    expect(sessionBefore.status).toBe(200);
    expect(await sessionBefore.json()).toMatchObject({
      success: true,
      identity: { id: invitedUserId },
      pendingIdentityCount: 1,
    });
    expect((await asUser(invitedToken, "/api/v1/users/current/groups")).status).toBe(403);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM group_memberships WHERE user_id = ? AND left_at IS NULL")
        .bind(invitedUserId)
        .first(),
    ).toEqual({ total: 0 });

    const accepted = await asUser(invitedToken, `/api/v1/users/current/identities/${identityId}`, {
      method: "PATCH",
      body: JSON.stringify({ transition: { state: "active" } }),
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(await accepted.json()).toMatchObject({ success: true, identityId, state: "active" });
    expect(
      await env.DB.prepare("SELECT started_at, ended_at FROM identities WHERE id = ?").bind(identityId).first(),
    ).toMatchObject({ started_at: expect.any(String), ended_at: null });
    expect(
      Number(
        (
          await env.DB.prepare("SELECT COUNT(*) AS total FROM group_memberships WHERE user_id = ? AND left_at IS NULL")
            .bind(invitedUserId)
            .first<{ total: number }>()
        )?.total ?? 0,
      ),
    ).toBeGreaterThan(0);
  });

  it("does not reveal or accept another user's pending identity", async () => {
    const { identityId } = await inviteIdentity();
    const other = await insertIndividualMember(env.DB, "H6", "other@invitation-lifecycle.example");
    const otherToken = await createMemberSession(
      env.DB,
      other.userId,
      "other-identity-session-token",
      undefined,
      other.identityId,
    );

    const response = await asUser(otherToken, `/api/v1/users/current/identities/${identityId}`, {
      method: "PATCH",
      body: JSON.stringify({ transition: { state: "active" } }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "IDENTITY_INVITATION_NOT_FOUND" } });
  });

  it("rolls back acceptance and enrollment if the session or invitation changes before commit", async () => {
    const { identityId, invitedUserId } = await inviteIdentity();
    const session = await env.DB.prepare(
      "SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
      .bind(invitedUserId)
      .first<{ id: string }>();
    expect(session).toBeTruthy();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?").bind(session!.id).run(),
    );

    await expect(
      acceptPendingIdentity(racingDb, { identityId, userId: invitedUserId, sessionId: session!.id }),
    ).rejects.toMatchObject({ status: 409, code: "IDENTITY_AUTHORIZATION_CHANGED" });
    expect(await env.DB.prepare("SELECT started_at FROM identities WHERE id = ?").bind(identityId).first()).toEqual({
      started_at: null,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM group_memberships WHERE user_id = ? AND left_at IS NULL")
        .bind(invitedUserId)
        .first(),
    ).toEqual({ total: 0 });
  });
});
