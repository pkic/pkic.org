import { beforeEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { grantAdministrator } from "./helpers/administrator";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { resetDb } from "./helpers/reset-db";
import { getCurrentUserBackedAdmin } from "../functions/_lib/auth/admin";
import { preparePermissionsAuthorizationGuard } from "../functions/_lib/auth/permissions";
import { approveOauthAuthorization } from "../functions/_lib/services/oauth-authorizations/approval";
import {
  processOauthAuthorizationCompletion,
  runOauthAuthorizationCompletions,
} from "../functions/_lib/services/oauth-authorizations/completion";
import { openOauthCompletion } from "../functions/_lib/services/oauth-authorizations/completion-payload";
import { readActiveOauthAuthorization } from "../functions/_lib/auth/oauth/authorization-ceiling";
import { effectiveMcpPermissionContexts } from "../functions/_lib/auth/oauth/grantable-permissions";
import { oauthAuthorizationsQuerySchema } from "../assets/shared/schemas/oauth-authorizations";
import { listOwnedOauthAuthorizations } from "../functions/_lib/services/oauth-authorizations/read-model";

const env = { ...workerEnv, INTERNAL_SIGNING_SECRET: "synthetic-oauth-test-signing-secret-32-plus" };
const request: AuthRequest = {
  responseType: "code",
  clientId: "test-client",
  redirectUri: "https://client.test/callback",
  scope: ["forms:read", "forms:write"],
  state: "opaque-state",
  codeChallenge: "challenge",
  codeChallengeMethod: "S256",
};
let userId: string, sessionId: string, token: string, eventId: string;
async function actor() {
  return (await getCurrentUserBackedAdmin(env.DB, userId, sessionId))!;
}
async function approve(selectedScopes: unknown = ["forms:read"], actorOverride?: Awaited<ReturnType<typeof actor>>) {
  return approveOauthAuthorization(env.DB, {
    request,
    actor: actorOverride ?? (await actor()),
    member: null,
    actingIdentityId: null,
    expectedActingIdentityId: null,
    staffIdleExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    clientName: "Test client",
    selectedScopes,
    signingSecret: env.INTERNAL_SIGNING_SECRET,
  });
}
function provider(
  complete = vi.fn().mockResolvedValue({ redirectTo: "https://client.test/callback?code=secret&state=opaque-state" }),
) {
  return { completeAuthorization: complete } as unknown as OAuthHelpers;
}
function call(path: string, body?: unknown, method = "GET", headers?: Record<string, string>) {
  return callApi(env, `/api/v1/auth/oauth/authorizations${path}`, {
    method,
    headers: { cookie: `pkic_session=${token}`, ...(body ? { "content-type": "application/json" } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function active() {
  const result = await approve();
  expect(await processOauthAuthorizationCompletion(env, result.authorizationId, provider())).toBe("completed");
  return result.authorizationId;
}
async function review(id: string) {
  const response = await call(`/${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as { authorization: { revision: string; status: string; scopeCount: number } };
}
beforeEach(async () => {
  await resetDb();
  const seeded = await seedEventAndAdmin(env.DB);
  userId = seeded.admin.id;
  eventId = seeded.eventId;
  token = await createAdminSession(env.DB, userId, crypto.randomUUID(), env.INTERNAL_SIGNING_SECRET);
  [{ id: sessionId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM sessions WHERE user_id=?", [userId]);
});

describe("frozen OAuth approval and durable completion", () => {
  it.each([undefined, [], ["forms:*"], ["forms:read", "forms:read"], "forms:read"])(
    "rejects malformed or empty selections (%j) without an intent",
    async (selection) => {
      await expect(approve(selection === undefined ? null : selection)).rejects.toThrow();
      expect(await queryAll(env.DB, "SELECT id FROM oauth_authorizations")).toHaveLength(0);
    },
  );
  it("rejects canonical but unrequested permissions", async () => {
    await expect(approve(["users:read"])).rejects.toMatchObject({ code: "SCOPE_NOT_REQUESTED" });
  });
  it("rechecks authority in the approval command and rolls back the complete intent", async () => {
    const stale = await actor();
    await env.DB.prepare("DELETE FROM user_roles WHERE user_id=?").bind(userId).run();
    await expect(approve(["forms:read"], stale)).rejects.toMatchObject({ code: "AUTHORIZATION_CONTEXT_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM oauth_authorizations")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT authorization_id FROM oauth_authorization_completions")).toHaveLength(0);
  });
  it("refuses approval when the displayed acting identity no longer matches the session", async () => {
    await expect(
      approveOauthAuthorization(env.DB, {
        request,
        actor: await actor(),
        member: null,
        actingIdentityId: null,
        expectedActingIdentityId: crypto.randomUUID(),
        staffIdleExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        clientName: "Test client",
        selectedScopes: ["forms:read"],
        signingSecret: env.INTERNAL_SIGNING_SECRET,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_CONTEXT_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM oauth_authorizations")).toHaveLength(0);
  });
  it("records only the selected ceiling, encrypts callbacks, and completes once", async () => {
    const { authorizationId: id } = await approve();
    const pending = await call(`/${id}/completion`);
    expect(await pending.json()).toEqual({ status: "pending" });
    const [intent] = await queryAll<{ request_ciphertext: string }>(
      env.DB,
      "SELECT request_ciphertext FROM oauth_authorization_completions WHERE authorization_id=?",
      [id],
    );
    expect(intent.request_ciphertext).not.toContain("opaque-state");
    const complete = vi.fn().mockResolvedValue({ redirectTo: "https://client.test/callback?code=secret" });
    expect(await processOauthAuthorizationCompletion(env, id, provider(complete))).toBe("completed");
    expect(await processOauthAuthorizationCompletion(env, id, provider(complete))).toBe("skipped");
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0][0]).toMatchObject({
      scope: ["forms:read"],
      props: { authorizationId: id, scopes: ["forms:read"] },
      revokeExistingGrants: false,
    });
    const response = await call(`/${id}/completion`);
    expect(await response.json()).toEqual({ status: "active", redirectTo: "https://client.test/callback?code=secret" });
    const [completed] = await queryAll<{ request_ciphertext: null; redirect_ciphertext: string }>(
      env.DB,
      "SELECT request_ciphertext,redirect_ciphertext FROM oauth_authorization_completions WHERE authorization_id=?",
      [id],
    );
    expect(completed.request_ciphertext).toBeNull();
    expect(completed.redirect_ciphertext).not.toContain("secret");
  });
  it("freezes resource limits even after a global role is added", async () => {
    await env.DB.prepare("DELETE FROM user_roles WHERE user_id=?").bind(userId).run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,granted_by_user_id,created_at) VALUES(?,?,'forms:read','event',?,?,?)",
    )
      .bind(crypto.randomUUID(), userId, eventId, userId, new Date().toISOString())
      .run();
    const id = await active();
    await grantAdministrator(env.DB, userId);
    const ceiling = await readActiveOauthAuthorization(env.DB, { id, userId, sessionId });
    expect(ceiling.scopes).toEqual([{ permission: "forms:read", contextType: "event", contextId: eventId }]);
    expect(effectiveMcpPermissionContexts(await actor(), ceiling.scopes, ["forms:read", "forms:write"])).toEqual(
      ceiling.scopes,
    );
    const delegated = {
      ...(await actor()),
      oauthAuthorizationId: id,
      scopeRestricted: true,
      scopes: ["forms:read"] as const,
    };
    await expect(
      env.DB.batch([
        preparePermissionsAuthorizationGuard(env.DB, { ...delegated, scopes: [...delegated.scopes] }, [
          { permission: "forms:read", context: { type: "event", id: crypto.randomUUID() } },
        ]),
      ]),
    ).rejects.toThrow();
    await env.DB.batch([
      preparePermissionsAuthorizationGuard(env.DB, { ...delegated, scopes: [...delegated.scopes] }, [
        { permission: "forms:read", context: { type: "event", id: eventId } },
      ]),
    ]);
  });
  it("freezes a nonmember acting identity and refuses tokens when that identity ends", async () => {
    const { identityId, statement } = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId: null,
      source: "staff",
      startImmediately: true,
    });
    await env.DB.batch([statement]);
    const { authorizationId: id } = await approveOauthAuthorization(env.DB, {
      request,
      actor: await actor(),
      member: null,
      actingIdentityId: identityId,
      expectedActingIdentityId: identityId,
      staffIdleExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      clientName: "Test client",
      selectedScopes: ["forms:read"],
      signingSecret: env.INTERNAL_SIGNING_SECRET,
    });
    expect(await processOauthAuthorizationCompletion(env, id, provider())).toBe("completed");
    expect((await readActiveOauthAuthorization(env.DB, { id, userId, sessionId })).identityId).toBe(identityId);
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?")
      .bind(new Date().toISOString(), identityId)
      .run();
    await expect(readActiveOauthAuthorization(env.DB, { id, userId, sessionId })).rejects.toMatchObject({
      status: 401,
    });
  });
  it.each(["client", "owner", "session"])("rejects a mismatched %s at token resolution", async (dimension) => {
    const id = await active();
    await expect(
      readActiveOauthAuthorization(env.DB, {
        id,
        userId: dimension === "owner" ? crypto.randomUUID() : userId,
        sessionId: dimension === "session" ? crypto.randomUUID() : sessionId,
        clientId: dimension === "client" ? "another-client" : "test-client",
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("recovers provider failure through the durable retry owner", async () => {
    const { authorizationId: id } = await approve();
    expect(
      await processOauthAuthorizationCompletion(env, id, provider(vi.fn().mockRejectedValue(new Error("temporary")))),
    ).toBe("retrying");
    await env.DB.prepare("UPDATE oauth_authorization_completions SET next_attempt_at=? WHERE authorization_id=?")
      .bind(new Date(Date.now() - 1000).toISOString(), id)
      .run();
    expect(await processOauthAuthorizationCompletion(env, id, provider())).toBe("completed");
    expect((await review(id)).authorization.status).toBe("active");
  });
  it("does not activate after authority is removed during provider completion", async () => {
    const { authorizationId: id } = await approve();
    const complete = vi.fn().mockImplementation(async () => {
      await env.DB.prepare("DELETE FROM user_roles WHERE user_id=?").bind(userId).run();
      return { redirectTo: "https://client.test/callback?code=orphan" };
    });
    expect(await processOauthAuthorizationCompletion(env, id, provider(complete))).toBe("failed");
    expect((await review(id)).authorization.status).toBe("failed");
    await expect(readActiveOauthAuthorization(env.DB, { id, userId, sessionId })).rejects.toMatchObject({
      status: 401,
    });
  });
  it("blocks an unapproved write in the atomic database permission guard", async () => {
    const id = await active();
    const delegated = {
      ...(await actor()),
      oauthAuthorizationId: id,
      scopeRestricted: true,
      scopes: ["forms:read", "forms:write"] as ("forms:read" | "forms:write")[],
    };
    await expect(
      env.DB.batch([preparePermissionsAuthorizationGuard(env.DB, delegated, [{ permission: "forms:write" }])]),
    ).rejects.toThrow();
    await env.DB.batch([preparePermissionsAuthorizationGuard(env.DB, delegated, [{ permission: "forms:read" }])]);
    const { authorization } = await review(id);
    expect((await call(`/${id}/revoke`, { revision: authorization.revision }, "POST")).status).toBe(200);
    await expect(
      env.DB.batch([preparePermissionsAuthorizationGuard(env.DB, delegated, [{ permission: "forms:read" }])]),
    ).rejects.toThrow();
  });
  it("prevents a stale completion owner from overwriting its replacement lease", async () => {
    const { authorizationId: id } = await approve();
    const complete = vi.fn().mockImplementation(async () => {
      await env.DB.prepare(
        "UPDATE oauth_authorization_completions SET processing_token='replacement-owner' WHERE authorization_id=?",
      )
        .bind(id)
        .run();
      return { redirectTo: "https://client.test/callback?code=stale" };
    });
    expect(await processOauthAuthorizationCompletion(env, id, provider(complete))).toBe("skipped");
    const [intent] = await queryAll<{ processing_token: string; status: string }>(
      env.DB,
      "SELECT processing_token,status FROM oauth_authorization_completions WHERE authorization_id=?",
      [id],
    );
    expect(intent).toEqual({ processing_token: "replacement-owner", status: "processing" });
    expect((await review(id)).authorization.status).toBe("pending");
    await env.DB.prepare("UPDATE oauth_authorization_completions SET lease_expires_at=? WHERE authorization_id=?")
      .bind(new Date(Date.now() - 1000).toISOString(), id)
      .run();
    expect(await processOauthAuthorizationCompletion(env, id, provider())).toBe("completed");
  });
  it("keeps an older in-flight approval inactive after a newer approval replaces it", async () => {
    const { authorizationId: id } = await approve();
    let replacement = "";
    const complete = vi.fn().mockImplementation(async () => {
      replacement = (await approve()).authorizationId;
      return { redirectTo: "https://client.test/callback?code=stale" };
    });
    expect(await processOauthAuthorizationCompletion(env, id, provider(complete))).toBe("skipped");
    expect((await review(id)).authorization.status).toBe("revoked");
    expect(await processOauthAuthorizationCompletion(env, replacement, provider())).toBe("completed");
  });
  it("binds encrypted approval to its authorization and replaces the old client connection", async () => {
    const { authorizationId: first } = await approve();
    const [intent] = await queryAll<{ request_ciphertext: string }>(
      env.DB,
      "SELECT request_ciphertext FROM oauth_authorization_completions WHERE authorization_id=?",
      [first],
    );
    const { authorizationId: second } = await approve();
    await expect(openOauthCompletion(intent.request_ciphertext, env.INTERNAL_SIGNING_SECRET, second)).rejects.toThrow();
    expect(await processOauthAuthorizationCompletion(env, first, provider())).toBe("skipped");
    expect((await review(first)).authorization.status).toBe("revoked");
    expect(await processOauthAuthorizationCompletion(env, second, provider())).toBe("completed");
  });
  it("expires abandoned intents and returns an explicit completion result", async () => {
    const { authorizationId: id } = await approve();
    await env.DB.prepare("UPDATE oauth_authorization_completions SET attempt_until=? WHERE authorization_id=?")
      .bind(new Date(Date.now() - 1000).toISOString(), id)
      .run();
    expect(await (await call(`/${id}/completion`)).json()).toEqual({ status: "expired" });
    expect((await runOauthAuthorizationCompletions(env)).expired).toBe(1);
    expect((await review(id)).authorization.status).toBe("failed");
  });
});

describe("account-owned authorization routes", () => {
  it("lists, filters, searches and paginates authorizations on the backend", async () => {
    const id = await active();
    const response = await call("?q=Test&status=active&limit=1&sort=-createdAt");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authorizations: [{ id, scopeCount: 1 }], page: { total: 1 } });
    expect(await (await call("?q=absent")).json()).toMatchObject({ authorizations: [], page: { total: 0 } });
    const scopes = await call(`/${id}/scopes?domain=forms&access=read&limit=1`);
    expect(scopes.status).toBe(200);
    expect(await scopes.json()).toMatchObject({
      scopes: [{ permission: "forms:read", contextType: null }],
      page: { total: 1 },
    });
  });
  it("allows only removals, rejects stale revisions and revokes when the last scope is removed", async () => {
    const id = await active(),
      { authorization } = await review(id);
    const invalid = await call(
      `/${id}`,
      { revision: authorization.revision, remove: [{ permission: "forms:write", contextType: null, contextId: null }] },
      "PATCH",
    );
    expect(invalid.status).toBe(409);
    const reduced = await call(
      `/${id}`,
      { revision: authorization.revision, remove: [{ permission: "forms:read", contextType: null, contextId: null }] },
      "PATCH",
    );
    expect(reduced.status).toBe(200);
    expect(await reduced.json()).toMatchObject({ authorization: { status: "revoked", scopeCount: 0 } });
    expect((await call(`/${id}/revoke`, { revision: authorization.revision }, "POST")).status).toBe(409);
    await expect(readActiveOauthAuthorization(env.DB, { id, userId, sessionId })).rejects.toMatchObject({
      status: 401,
    });
  });
  it("rolls back a reduction and its audit when revocation wins the command race", async () => {
    const id = await active(),
      { authorization } = await review(id);
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => /UPDATE oauth_authorizations SET updated_at/.test(sql),
      () =>
        env.DB.prepare("UPDATE oauth_authorizations SET status='revoked',updated_at=? WHERE id=?")
          .bind(new Date(Date.now() + 1000).toISOString(), id)
          .run(),
    );
    const response = await callApi({ ...env, DB: db }, `/api/v1/auth/oauth/authorizations/${id}`, {
      method: "PATCH",
      headers: { cookie: `pkic_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        revision: authorization.revision,
        remove: [{ permission: "forms:read", contextType: null, contextId: null }],
      }),
    });
    expect(response.status).toBe(409);
    expect(
      await queryAll(env.DB, "SELECT id FROM oauth_authorization_permissions WHERE authorization_id=?", [id]),
    ).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='oauth_authorization_reduced' AND entity_id=?", [
        id,
      ]),
    ).toHaveLength(0);
  });
  it("revokes without requiring staff permissions and rejects cross-origin mutations", async () => {
    const id = await active(),
      { authorization } = await review(id);
    expect(
      (await call(`/${id}/revoke`, { revision: authorization.revision }, "POST", { origin: "https://evil.test" }))
        .status,
    ).toBe(403);
    await env.DB.prepare("DELETE FROM user_roles WHERE user_id=?").bind(userId).run();
    expect((await call(`/${id}/revoke`, { revision: authorization.revision }, "POST")).status).toBe(200);
    expect(await (await call(`/${id}/completion`)).json()).toEqual({ status: "revoked" });
  });
  it("does not reveal another person's authorization or completion", async () => {
    const id = await active();
    // A separate real account is necessary even on a freshly migrated database.
    const otherId = crypto.randomUUID(),
      at = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,'other@test.example','other@test.example',1,?,?)",
    )
      .bind(otherId, at, at)
      .run();
    token = await createAdminSession(env.DB, otherId, crypto.randomUUID(), env.INTERNAL_SIGNING_SECRET);
    for (const path of [`/${id}`, `/${id}/scopes`, `/${id}/completion`]) expect((await call(path)).status).toBe(404);
  });
  it("guards reads against a revoked account session", async () => {
    await active();
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").bind(new Date().toISOString(), sessionId).run();
    await expect(
      listOwnedOauthAuthorizations(
        env.DB,
        { userId, sessionId, member: null },
        oauthAuthorizationsQuerySchema.parse({}),
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_CONTEXT_CHANGED" });
  });
});
