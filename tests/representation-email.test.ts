import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { proposalIdentityFixture } from "./helpers/proposal-identity";
import { assignRepresentativeRole, REPRESENTATIVE_ROLE_IDS, insertUser } from "./helpers/membership";
import { createAdminSession, createMcpSession } from "./helpers/auth";
import { nowIso } from "../functions/_lib/utils/time";
import { identityUpdateSchema } from "../assets/shared/schemas/identity";
import { preparePrimaryEmailDomainChange } from "../functions/_lib/services/identities/primary-email-domain-change";
import {
  representationEmailChangeSchema,
  representationEmailOptionsResponseSchema,
} from "../assets/shared/schemas/representation-email";
beforeEach(resetDb);
type Fixture = Awaited<ReturnType<typeof proposalIdentityFixture>>;
const path = (f: Fixture) => `/api/v1/users/${f.userId}/identities/${f.identityId}/email`;
async function domainIdentityFixture() {
  const f = await proposalIdentityFixture();
  const id = crypto.randomUUID();
  const at = nowIso();
  await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(at, f.identityId).run();
  await env.DB.prepare(`INSERT INTO identities(id,user_id,organization_id,source,verified_email_domain,job_title,
    invited_at,started_at,created_at,updated_at) SELECT ?,user_id,organization_id,'verified_email','example.test',job_title,?,?,?,?
    FROM identities WHERE id=?`)
    .bind(id, at, at, at, at, f.identityId)
    .run();
  return { ...f, identityId: id };
}
async function secondary(f: Fixture, verified = true, owner: string | null = f.identityId) {
  const id = crypto.randomUUID();
  const email = `address-${id}@other-work.example`;
  const at = nowIso();
  await env.DB.prepare(
    "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,verification_method,identity_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(id, f.userId, email, email, verified ? at : null, verified ? "magic_link" : null, owner, at)
    .run();
  return id;
}
function change(f: Fixture, previousEmailId: string | null, emailId: string | null, token = f.token, machine = false) {
  return callApi(
    env,
    path(f),
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(machine ? { "x-pkic-machine-auth": "mcp" } : {}),
      },
      body: JSON.stringify(representationEmailChangeSchema.parse({ previousEmailId, emailId })),
    },
    { maxRoundTrips: 1 },
  );
}
describe("representation email correction", () => {
  it("enforces the same domain guard through organization-managed profile edits", async () => {
    const f = await domainIdentityFixture();
    const unrelated = await secondary(f, true, null);
    const organizationId = await env.DB.prepare("SELECT organization_id FROM identities WHERE id=?")
      .bind(f.identityId)
      .first<string>("organization_id");
    const adminId = await env.DB.prepare("SELECT id FROM users WHERE normalized_email='admin@pkic.org'").first<string>(
      "id",
    );
    const token = await createAdminSession(env.DB, adminId!, crypto.randomUUID());
    const result = await callApi(env, `/api/v1/organizations/${organizationId}/identities/${f.identityId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(identityUpdateSchema.parse({ profile: { emailId: unrelated } })),
    });
    expect(result.status, await result.clone().text()).toBe(409);
    expect(
      await env.DB.prepare("SELECT email_id FROM identities WHERE id=?").bind(f.identityId).first("email_id"),
    ).toBeNull();
  });
  it("refuses an unrelated verified mailbox for a domain-backed identity and omits it from choices", async () => {
    const f = await domainIdentityFixture();
    const unrelated = await secondary(f, true, null);
    const before = await env.DB.prepare("SELECT email_id,organization_id,ended_at FROM identities WHERE id=?")
      .bind(f.identityId)
      .first();
    const response = await change(f, null, unrelated);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(
      await env.DB.prepare("SELECT email_id,organization_id,ended_at FROM identities WHERE id=?")
        .bind(f.identityId)
        .first(),
    ).toEqual(before);
    const listed = await callApi(
      env,
      path(f),
      { headers: { authorization: `Bearer ${f.token}` } },
      { maxRoundTrips: 1 },
    );
    expect(listed.status, await listed.clone().text()).toBe(200);
    const choices = representationEmailOptionsResponseSchema.parse(await listed.json());
    expect(choices.emails.some((email) => email.id === unrelated)).toBe(false);
    expect(choices.emails.some((email) => email.primary)).toBe(true);
  });

  it("allows another verified mailbox in the supporting domain", async () => {
    const f = await domainIdentityFixture();
    const related = await secondary(f, true, null);
    const email = `replacement-${related}@example.test`;
    await env.DB.prepare("UPDATE user_emails SET email=?,normalized_email=? WHERE id=?")
      .bind(email, email, related)
      .run();
    const response = await change(f, null, related);
    expect(response.status, await response.clone().text()).toBe(200);
  });

  it("does not count an unrelated reverse email association as domain support", async () => {
    const f = await domainIdentityFixture();
    await secondary(f);
    const nextEmail = `personal-${crypto.randomUUID()}@gmail.com`;
    await env.DB.prepare("UPDATE users SET email=?,normalized_email=? WHERE id=?")
      .bind(nextEmail, nextEmail, f.userId)
      .run();
    await env.DB.batch(
      preparePrimaryEmailDomainChange(env.DB, {
        userId: f.userId,
        previousEmail: f.email,
        nextEmail,
        at: nowIso(),
      }),
    );
    expect(
      await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(f.identityId).first("ended_at"),
    ).not.toBeNull();
  });
  it("changes only the selected address, preserves roles and records, and releases the incorrect reverse link", async () => {
    const f = await proposalIdentityFixture();
    const wrong = await secondary(f);
    const retainedAlias = await secondary(f);
    await env.DB.prepare("UPDATE identities SET email_id=? WHERE id=?").bind(wrong, f.identityId).run();
    const member = await env.DB.prepare("SELECT member_id FROM identity_member_capacities WHERE identity_id=?")
      .bind(f.identityId)
      .first<string>("member_id");
    await assignRepresentativeRole(env.DB, member!, f.userId, REPRESENTATIVE_ROLE_IDS.secondaryContact);
    const before = await env.DB.prepare(
      "SELECT id,organization_id,job_title,started_at,ended_at FROM identities WHERE id=?",
    )
      .bind(f.identityId)
      .first();
    const grants = await env.DB.prepare("SELECT id,role_id FROM user_roles WHERE identity_id=? ORDER BY id")
      .bind(f.identityId)
      .all();
    expect(grants.results.length).toBeGreaterThan(0);
    const response = await change(f, wrong, null);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await env.DB.prepare("SELECT id,organization_id,job_title,started_at,ended_at FROM identities WHERE id=?")
        .bind(f.identityId)
        .first(),
    ).toEqual(before);
    expect(
      (
        await env.DB.prepare("SELECT id,role_id FROM user_roles WHERE identity_id=? ORDER BY id")
          .bind(f.identityId)
          .all()
      ).results,
    ).toEqual(grants.results);
    expect(
      await env.DB.prepare("SELECT email_id FROM identities WHERE id=?").bind(f.identityId).first("email_id"),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT identity_id FROM user_emails WHERE id=?").bind(wrong).first("identity_id"),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT identity_id FROM user_emails WHERE id=?").bind(retainedAlias).first("identity_id"),
    ).toBe(f.identityId);
    const audit = await env.DB.prepare(
      "SELECT details_json FROM audit_log WHERE entity_id=? AND action='organization_identity_email_changed'",
    )
      .bind(f.identityId)
      .first<string>("details_json");
    expect(JSON.parse(audit!)).toMatchObject({ emailId: { from: wrong, to: null } });
  });
  it("lists only verified available addresses through a bounded one-batch page", async () => {
    const f = await proposalIdentityFixture();
    const own = await secondary(f, true, null);
    await secondary(f, false, null);
    await secondary(f, true, f.secondIdentityId);
    const response = await callApi(
      env,
      `${path(f)}?limit=1&sort=email`,
      { headers: { authorization: `Bearer ${f.token}` } },
      { maxRoundTrips: 1 },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = representationEmailOptionsResponseSchema.parse(await response.json());
    expect(body.page).toMatchObject({ total: 2, hasMore: true });
    expect(body.emails.every((email) => email.verifiedAt !== null)).toBe(true);
    const result = await change(f, null, own);
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await env.DB.prepare("SELECT identity_id FROM user_emails WHERE id=?").bind(own).first("identity_id")).toBe(
      f.identityId,
    );
  });
  it.each(["unverified", "other_identity", "foreign_account", "stale"] as const)(
    "refuses %s selections atomically",
    async (kind) => {
      const f = await proposalIdentityFixture();
      let selected: string | null = null;
      let token = f.token;
      let previous: string | null = null;
      if (kind === "unverified") selected = await secondary(f, false, null);
      if (kind === "other_identity") selected = await secondary(f, true, f.secondIdentityId);
      if (kind === "foreign_account")
        token = await createAdminSession(env.DB, await insertUser(env.DB), crypto.randomUUID());
      if (kind === "stale") previous = crypto.randomUUID();
      expect((await change(f, previous, selected, token)).status).toBe(409);
      expect(
        await env.DB.prepare("SELECT email_id FROM identities WHERE id=?").bind(f.identityId).first("email_id"),
      ).toBeNull();
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM audit_log WHERE action='organization_identity_email_changed'",
        ).first("count"),
      ).toBe(0);
    },
  );
  it("uses the same command for authorized staff and scoped MCP sessions", async () => {
    const f = await proposalIdentityFixture();
    const id = (await env.DB.prepare("SELECT id FROM users WHERE normalized_email='admin@pkic.org'").first<string>(
      "id",
    ))!;
    const address = await secondary(f, true, null);
    const token = await createAdminSession(env.DB, id, crypto.randomUUID());
    expect((await change(f, null, address, token)).status).toBe(200);
    const mcp = await createMcpSession(env.DB, { id, email: "admin@pkic.org" }, crypto.randomUUID(), [
      "membership:write",
    ]);
    expect((await change(f, address, null, mcp, true)).status).toBe(200);
    const limited = await createMcpSession(env.DB, { id, email: "admin@pkic.org" }, crypto.randomUUID(), [
      "membership:read",
    ]);
    expect((await change(f, null, address, limited, true)).status).toBe(409);
  });
});
