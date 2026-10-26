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
  const resolved = organizationResolved
    ? identityAffiliationPreviewResponseSchema.parse(
        await (await preview(p, { phase: "resolve", email: p.email, emailId: null })).json(),
      )
    : null;
  const response = await preview(p, {
    phase: "prepare",
    email: p.email,
    emailId: null,
    organizationId: resolved?.organization?.id ?? null,
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
  it("uses the existing personal identity only after explicit personal choice and mailbox proof", async () => {
    const p = await person("person@gmail.com");
    const response = await preview(p, {
      phase: "resolve",
      email: p.email,
      emailId: null,
      unaffiliatedAttestation: true,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const result = identityAffiliationPreviewResponseSchema.parse(await response.json());
    expect(result.organization).toBeNull();
    expect(result.organizations).toEqual([]);
    expect(result.identityId).toBe(
      await env.DB.prepare("SELECT id FROM identities WHERE user_id=? AND organization_id IS NULL")
        .bind(p.userId)
        .first("id"),
    );
    await env.DB.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").bind(p.userId).run();
    expect(
      (await preview(p, { phase: "resolve", email: p.email, emailId: null, unaffiliatedAttestation: true })).status,
    ).toBe(422);
  });
  it("steers a personal provider away from the work choice before requesting verification mail", async () => {
    const p = await person();
    const response = await callApi(env, "/api/v1/users/current/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${p.token}`, "content-type": "application/json" },
      body: JSON.stringify({ email: "person@gmail.com", purpose: "representation", unaffiliatedAttestation: false }),
    });
    expect(response.status, await response.clone().text()).toBe(400);
    expect(await response.text()).toContain("Please use your work address");
    expect(
      (await env.DB.prepare("SELECT id FROM user_emails WHERE normalized_email='person@gmail.com'").all()).results,
    ).toHaveLength(0);
  });
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

describe("confirmed organizations sharing a work domain", () => {
  it("completes a missing job title on the canonical existing representation", async () => {
    const p = await person();
    const made = await create(p, await prepare(p, false, "Existing representation"));
    const { identityId } = identityMutationResponseSchema.parse(await made.json());
    await env.DB.prepare("UPDATE identities SET job_title=NULL WHERE id=?").bind(identityId).run();
    const completed = await create(p, await prepare(p, true));
    expect(completed.status, await completed.clone().text()).toBe(201);
    expect(identityMutationResponseSchema.parse(await completed.json()).identityId).toBe(identityId);
    expect(
      await env.DB.prepare("SELECT job_title FROM identities WHERE id=?").bind(identityId).first("job_title"),
    ).toBe("Security engineer");
  });
  it("creates a separate organization and lets a colleague explicitly choose it without a domain claim", async () => {
    const first = await person();
    const firstCreated = await create(first, await prepare(first, false, "Northstar Parent"));
    expect(firstCreated.status).toBe(201);
    const second = await person("second@northstar-work.test");
    const secondCreated = await create(second, await prepare(second, false, "Northstar Subsidiary"));
    expect(secondCreated.status, await secondCreated.clone().text()).toBe(201);
    const third = await person("third@northstar-work.test");
    const resolved = identityAffiliationPreviewResponseSchema.parse(
      await (await preview(third, { phase: "resolve", email: third.email, emailId: null })).json(),
    );
    expect(resolved.organization).toBeNull();
    expect(resolved.organizations.map((item) => item.name).sort()).toEqual([
      "Northstar Parent",
      "Northstar Subsidiary",
    ]);
    const subsidiary = resolved.organizations.find((item) => item.name === "Northstar Subsidiary")!;
    const prepared = await preview(third, {
      phase: "prepare",
      email: third.email,
      emailId: null,
      organizationId: subsidiary.id,
      jobTitle: "Research engineer",
    });
    expect(prepared.status, await prepared.clone().text()).toBe(200);
    const result = await create(
      third,
      identityAffiliationPreviewResponseSchema.parse(await prepared.json()).contextToken!,
    );
    expect(result.status, await result.clone().text()).toBe(201);
    const { identityId } = identityMutationResponseSchema.parse(await result.json());
    expect(
      await env.DB.prepare("SELECT organization_id,job_title FROM identities WHERE id=?").bind(identityId).first(),
    ).toEqual({ organization_id: subsidiary.id, job_title: "Research engineer" });
    expect((await env.DB.prepare("SELECT id FROM organization_domain_claims").all()).results).toHaveLength(0);
    expect((await env.DB.prepare("SELECT id FROM members").all()).results).toHaveLength(0);
  });
  it("allows another named organization beside a claimed domain without changing its owner", async () => {
    const p = await person();
    const owner = await insertOrganization(env.DB, "Domain Owner");
    await claim("northstar-work.test", owner);
    const result = await create(p, await prepare(p, false, "Shared-domain subsidiary"));
    expect(result.status, await result.clone().text()).toBe(201);
    const { identityId } = identityMutationResponseSchema.parse(await result.json());
    expect(
      await env.DB.prepare("SELECT organization_id FROM identities WHERE id=?")
        .bind(identityId)
        .first("organization_id"),
    ).not.toBe(owner);
    expect(
      await env.DB.prepare(
        "SELECT organization_id FROM organization_domain_claims WHERE domain='northstar-work.test'",
      ).first("organization_id"),
    ).toBe(owner);
    expect(
      (await env.DB.prepare("SELECT id FROM user_roles WHERE user_id=?").bind(p.userId).all()).results,
    ).toHaveLength(0);
  });
  it("refuses an unrelated organization selection after mailbox proof", async () => {
    const p = await person();
    const unrelated = await insertOrganization(env.DB, "Unrelated organization");
    const result = await preview(p, {
      phase: "prepare",
      email: p.email,
      emailId: null,
      organizationId: unrelated,
      jobTitle: "Engineer",
    });
    expect(result.status).toBe(422);
  });
});

function removeRepresentation(p: Awaited<ReturnType<typeof person>>, identityId: string) {
  return callApi(
    env,
    `${CREATE}/${identityId}`,
    { method: "DELETE", headers: { authorization: `Bearer ${p.token}` } },
    { maxRoundTrips: 1 },
  );
}
describe("removing an incorrect representation", () => {
  it("rolls back when another record still depends on the association", async () => {
    const p = await person();
    const made = await create(p, await prepare(p, false, "Representation with a successor"));
    const { identityId } = identityMutationResponseSchema.parse(await made.json());
    await env.DB.prepare(`INSERT INTO identities(id,user_id,organization_id,source,invited_at,created_at,updated_at,predecessor_identity_id)
      SELECT ?,user_id,organization_id,'staff',?,?,?,id FROM identities WHERE id=?`)
      .bind(crypto.randomUUID(), nowIso(), nowIso(), nowIso(), identityId)
      .run();
    const response = await removeRepresentation(p, identityId);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.text()).toContain("IDENTITY_HAS_PARTICIPATION");
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(identityId).first("id")).toBe(identityId);
  });
  it("deletes the association instead of retaining a former-identity row", async () => {
    const p = await person();
    const made = await create(p, await prepare(p, false, "Incorrect association"));
    const { identityId } = identityMutationResponseSchema.parse(await made.json());
    const result = await removeRepresentation(p, identityId);
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(identityId).first()).toBeNull();
  });
  it("refuses another person's association, the personal identity, and a blocked relationship", async () => {
    const p = await person();
    const made = await create(p, await prepare(p, false, "Representation"));
    const { identityId } = identityMutationResponseSchema.parse(await made.json());
    const stranger = await person("other@unrelated-work.test");
    expect((await removeRepresentation(stranger, identityId)).status).toBe(409);
    const personal = await env.DB.prepare("SELECT id FROM identities WHERE user_id=? AND organization_id IS NULL")
      .bind(p.userId)
      .first<string>("id");
    expect((await removeRepresentation(p, personal!)).status).toBe(409);
    await env.DB.prepare("UPDATE identities SET ended_at=?,blocked_at=? WHERE id=?")
      .bind(nowIso(), nowIso(), identityId)
      .run();
    expect((await removeRepresentation(p, identityId)).status).toBe(409);
  });
});
