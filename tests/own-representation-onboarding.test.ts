import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { insertOrganization, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { nowIso } from "../functions/_lib/utils/time";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import {
  identityAffiliationPreviewSchema,
  identityAffiliationPreviewResponseSchema,
} from "../assets/shared/schemas/identity-affiliation";
import { currentUserIdentityCreateSchema, identityMutationResponseSchema } from "../assets/shared/schemas/identity";
import type { DatabaseLike } from "../functions/_lib/types";

const PREVIEW = "/api/v1/users/current/identities/preview";
const CREATE = "/api/v1/users/current/identities";
beforeEach(resetDb);
async function person(email = "person@northstar-work.test", verified = true) {
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET email_verified_at=?,email_verification_method='magic_link' WHERE id=?")
    .bind(verified ? nowIso() : null, userId)
    .run();
  const identity = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId: null,
    source: "account",
    startImmediately: true,
  });
  await env.DB.batch([identity.statement]);
  const token = await createMemberSession(env.DB, userId, crypto.randomUUID());
  return { userId, token, email };
}
function preview(p: Awaited<ReturnType<typeof person>>, body: unknown, db: DatabaseLike = env.DB) {
  return callApi(
    { ...env, DB: db },
    PREVIEW,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.token}` },
      body: JSON.stringify(identityAffiliationPreviewSchema.parse(body)),
    },
    { maxRoundTrips: 1 },
  );
}
function create(p: Awaited<ReturnType<typeof person>>, contextToken: string) {
  return callApi(
    env,
    CREATE,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.token}` },
      body: JSON.stringify(currentUserIdentityCreateSchema.parse({ contextToken })),
    },
    { maxRoundTrips: 1 },
  );
}
async function prepare(
  p: Awaited<ReturnType<typeof person>>,
  organizationResolved: boolean,
  organizationName?: string,
) {
  const response = await preview(p, {
    phase: "prepare",
    email: p.email,
    emailId: null,
    organizationResolved,
    organizationName,
    jobTitle: "Security engineer",
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const prepared = identityAffiliationPreviewResponseSchema.parse(await response.json());
  return prepared.contextToken!;
}
async function claim(domain: string, organizationId: string) {
  await env.DB.prepare(
    "INSERT INTO organization_domain_claims(id,domain,organization_id,application_id,created_at,updated_at) VALUES(?,?,?,NULL,?,?)",
  )
    .bind(crypto.randomUUID(), domain, organizationId, nowIso(), nowIso())
    .run();
}
describe("email-first own representation", () => {
  it("reveals no organization until the selected owned address has been verified", async () => {
    const p = await person(undefined, false);
    const organizationId = await insertOrganization(env.DB, "Northstar Trust Association");
    await claim("northstar-work.test", organizationId);
    const response = await preview(p, { phase: "resolve", email: p.email, emailId: null });
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("Northstar Trust Association");
  });
  it("resolves and links the existing domain organization in one batch per request", async () => {
    const p = await person();
    const organizationId = await insertOrganization(env.DB, "Northstar Trust Association");
    await claim("northstar-work.test", organizationId);
    const response = await preview(p, { phase: "resolve", email: p.email, emailId: null });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(identityAffiliationPreviewResponseSchema.parse(await response.json()).organization).toEqual({
      id: organizationId,
      name: "Northstar Trust Association",
    });
    const created = await create(p, await prepare(p, true));
    expect(created.status, await created.clone().text()).toBe(201);
    const result = identityMutationResponseSchema.parse(await created.json());
    expect(
      await env.DB.prepare("SELECT organization_id,job_title FROM identities WHERE id=?")
        .bind(result.identityId)
        .first(),
    ).toEqual({ organization_id: organizationId, job_title: "Security engineer" });
    expect((await env.DB.prepare("SELECT id FROM organizations").all()).results).toHaveLength(1);
  });
  it("creates an organization only for an unclaimed verified work domain, then reuses it for a colleague", async () => {
    const p = await person();
    const unresolved = await preview(p, { phase: "resolve", email: p.email, emailId: null });
    expect(unresolved.status).toBe(200);
    const unresolvedBody = identityAffiliationPreviewResponseSchema.parse(await unresolved.json());
    expect(unresolvedBody.organization).toBeNull();
    expect(unresolvedBody.identityId).toBeUndefined();
    const first = await create(p, await prepare(p, false, "Northstar Trust Association"));
    expect(first.status, await first.clone().text()).toBe(201);
    const colleague = await person("colleague@northstar-work.test");
    const response = await preview(colleague, { phase: "resolve", email: colleague.email, emailId: null });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(identityAffiliationPreviewResponseSchema.parse(await response.json()).organization?.name).toBe(
      "Northstar Trust Association",
    );
    const second = await create(colleague, await prepare(colleague, true));
    expect(second.status, await second.clone().text()).toBe(201);
    expect((await env.DB.prepare("SELECT id FROM organizations").all()).results).toHaveLength(1);
    expect((await env.DB.prepare("SELECT id FROM organization_domain_claims").all()).results).toHaveLength(0);
    expect((await env.DB.prepare("SELECT id FROM members").all()).results).toHaveLength(0);
  });
  it.each(["person@gmail.com", "person@outlook.com", "person@sub.gmail.com", "person@xs4all.nl", "person@proton.me"])(
    "refuses shared/private providers after proof: %s",
    async (email) => {
      const p = await person(email);
      const response = await preview(p, { phase: "resolve", email: p.email, emailId: null });
      expect(response.status).toBe(422);
      expect(await response.text()).not.toContain('"organization":');
    },
  );
  it("rejects another account's address and invalidates a context when the domain is claimed before commit", async () => {
    const p = await person();
    const foreign = await preview(p, { phase: "resolve", email: "other@northstar-work.test", emailId: null });
    expect(foreign.status).toBe(422);
    const contextToken = await prepare(p, false, "New organization");
    const existing = await insertOrganization(env.DB, "Existing organization");
    await claim("northstar-work.test", existing);
    const response = await create(p, contextToken);
    expect(response.status).toBe(409);
    expect((await env.DB.prepare("SELECT name FROM organizations ORDER BY name").all()).results).toEqual([
      { name: "Existing organization" },
    ]);
  });
  it("binds prepared details to the owner's live session and rejects token tampering", async () => {
    const p = await person();
    const contextToken = await prepare(p, false, "Northstar Trust Association");
    const other = await person("other@harbor-work.test");
    expect((await create(other, contextToken)).status).toBe(403);
    expect((await create(p, `${contextToken.slice(0, -5)}AAAAA`)).status).toBe(403);
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), p.userId).run();
    expect((await create(p, contextToken)).status).toBe(409);
    expect((await env.DB.prepare("SELECT id FROM organizations").all()).results).toHaveLength(0);
  });
});
