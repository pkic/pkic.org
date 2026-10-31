import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { proposalSpeakerIdentityIdSql } from "../functions/_lib/services/proposal-speaker-profile-projection";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identityCorrectionSchema, identitiesListResponseSchema } from "../assets/shared/schemas/identity";
import { proposalCreateResponseSchema } from "../assets/shared/schemas/proposal-management";
import { proposalIdentityFixture, submitIdentityProposal } from "./helpers/proposal-identity";
import { createAdminSession, createMcpSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { resetDb } from "./helpers/reset-db";
import { nowIso } from "../functions/_lib/utils/time";
import {
  assignRepresentativeRole,
  REPRESENTATIVE_ROLE_IDS,
  insertUser,
  insertOrgRepresentative,
} from "./helpers/membership";

beforeEach(resetDb);
afterEach(() => vi.unstubAllGlobals());
type Fixture = Awaited<ReturnType<typeof proposalIdentityFixture>>;
function correct(f: Fixture, token = f.token, replacement = f.secondIdentityId, machine = false) {
  return callApi(
    env,
    `/api/v1/users/${f.userId}/identities/${f.identityId}/corrections`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(machine ? { "x-pkic-machine-auth": "mcp" } : {}),
      },
      body: JSON.stringify(
        identityCorrectionSchema.parse({
          replacementIdentityId: replacement,
          reason: "The organization was associated incorrectly.",
        }),
      ),
    },
    { maxRoundTrips: 1 },
  );
}
async function registration(f: Fixture) {
  const id = crypto.randomUUID();
  const at = nowIso();
  await env.DB.prepare(`INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,registration_identity_id,created_at,updated_at)
    VALUES(?,?,?,'registered','in_person','test',?,?,?,?)`)
    .bind(id, f.eventId, f.userId, crypto.randomUUID(), f.identityId, at, at)
    .run();
  return id;
}
async function staff() {
  const id = (await env.DB.prepare("SELECT id FROM users WHERE normalized_email='admin@pkic.org'").first<string>(
    "id",
  ))!;
  return { id, token: await createAdminSession(env.DB, id, crypto.randomUUID()) };
}

async function personalIdentity(userId: string) {
  const existing = await env.DB.prepare(
    "SELECT id FROM identities WHERE user_id=? AND organization_id IS NULL AND ended_at IS NULL",
  )
    .bind(userId)
    .first<string>("id");
  if (existing) return existing;
  const prepared = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId: null,
    source: "account",
    startImmediately: true,
  });
  await env.DB.batch([prepared.statement]);
  return prepared.identityId;
}

describe("organization association correction", () => {
  it.each([
    ["organization", "organization"],
    ["organization", "personal"],
    ["personal", "organization"],
  ] as const)(
    "corrects a %s identity to the %s identity without losing linked participation",
    async (sourceKind, kind) => {
      const f = await proposalIdentityFixture();
      if (sourceKind === "personal") {
        f.identityId = await personalIdentity(f.userId);
        f.body.proposer.actingIdentityId = null;
        f.body.unaffiliatedAttestation = true;
        await env.DB.prepare("UPDATE identities SET is_default=0 WHERE user_id=?").bind(f.userId).run();
        await env.DB.prepare("UPDATE identities SET is_default=1 WHERE id=?").bind(f.identityId).run();
      }
      const replacement = kind === "personal" ? await personalIdentity(f.userId) : f.secondIdentityId;
      // Transport fake: this fixture never sends real mail or fetches remote artwork.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 202 })),
      );
      await seedWorkflowEmailTemplates(env.DB, (await staff()).id);
      const submitted = await submitIdentityProposal(f.body, f.token);
      expect(submitted.status, await submitted.clone().text()).toBe(200);
      const { proposalId } = proposalCreateResponseSchema.parse(await submitted.json());
      const registrationId = await registration(f);
      if (sourceKind === "personal") {
        await env.DB.prepare("UPDATE registrations SET registration_identity_id=NULL WHERE id=?")
          .bind(registrationId)
          .run();
        const blocked = await callApi(
          env,
          `/api/v1/users/${f.userId}/identities/${f.identityId}`,
          { method: "DELETE", headers: { authorization: `Bearer ${f.token}` } },
          { maxRoundTrips: 1 },
        );
        expect(blocked.status).toBe(409);
      }
      const sourceMember = await env.DB.prepare("SELECT member_id FROM identity_member_capacities WHERE identity_id=?")
        .bind(f.identityId)
        .first<string>("member_id");
      if (sourceMember)
        await assignRepresentativeRole(env.DB, sourceMember, f.userId, REPRESENTATIVE_ROLE_IDS.secondaryContact);
      if (sourceMember)
        expect(
          await env.DB.prepare("SELECT count(*) AS count FROM user_roles WHERE identity_id=?")
            .bind(f.identityId)
            .first("count"),
        ).toBeGreaterThan(0);
      if (kind === "organization") {
        const title = await env.DB.prepare("SELECT job_title FROM identities WHERE id=?")
          .bind(replacement)
          .first<string>("job_title");
        await env.DB.prepare("UPDATE identities SET job_title=NULL WHERE id=?").bind(replacement).run();
        expect((await correct(f, f.token, replacement)).status).toBe(409);
        expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBe(
          f.identityId,
        );
        await env.DB.prepare("UPDATE identities SET job_title=? WHERE id=?").bind(title, replacement).run();
      }
      const response = await correct(f, f.token, replacement);
      expect(response.status, await response.clone().text()).toBe(200);
      const sessionResponse = await callApi(
        env,
        "/api/v1/users/current/identities",
        { headers: { authorization: `Bearer ${f.token}` } },
        { maxRoundTrips: 1 },
      );
      expect(sessionResponse.status).toBe(200);
      const accessible = identitiesListResponseSchema.parse(await sessionResponse.json());
      expect(accessible.identities.some((identity) => identity.id === replacement)).toBe(true);
      expect(accessible.identities.some((identity) => identity.id === f.identityId)).toBe(false);
      expect(
        await env.DB.prepare("SELECT registration_identity_id FROM registrations WHERE id=?")
          .bind(registrationId)
          .first("registration_identity_id"),
      ).toBe(replacement);
      expect(
        await env.DB.prepare("SELECT acting_identity_id FROM proposal_speakers WHERE proposal_id=? AND user_id=?")
          .bind(proposalId, f.userId)
          .first("acting_identity_id"),
      ).toBe(kind === "personal" ? null : replacement);
      expect(
        await env.DB.prepare(
          `SELECT ${proposalSpeakerIdentityIdSql("speaker")} AS identity_id FROM proposal_speakers speaker WHERE speaker.proposal_id=? AND speaker.user_id=?`,
        )
          .bind(proposalId, f.userId)
          .first("identity_id"),
      ).toBe(replacement);
      expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBeNull();
      expect(
        await env.DB.prepare("SELECT count(*) AS count FROM user_roles WHERE identity_id=?")
          .bind(f.identityId)
          .first("count"),
      ).toBe(0);
      expect(
        await env.DB.prepare("SELECT count(*) AS count FROM user_roles WHERE identity_id=? AND role_id=?")
          .bind(replacement, REPRESENTATIVE_ROLE_IDS.secondaryContact)
          .first("count"),
      ).toBe(0);
      expect(
        await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(replacement).first("ended_at"),
      ).toBeNull();
    },
  );
  it.each(["organization", "personal"])("refuses correcting a %s identity to itself", async (kind) => {
    const f = await proposalIdentityFixture();
    if (kind === "personal") f.identityId = await personalIdentity(f.userId);
    expect((await correct(f, f.token, f.identityId)).status).toBe(409);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBe(
      f.identityId,
    );
  });
  it("allows authorized staff to correct another person's association", async () => {
    const f = await proposalIdentityFixture();
    const actor = await staff();
    const response = await correct(f, actor.token);
    expect(response.status, await response.clone().text()).toBe(200);
  });
  it("uses the same correction for an appropriately scoped MCP session", async () => {
    const f = await proposalIdentityFixture();
    const actor = await staff();
    const token = await createMcpSession(env.DB, { id: actor.id, email: "admin@pkic.org" }, crypto.randomUUID(), [
      "membership:write",
      "identities:activate",
    ]);
    const response = await correct(f, token, f.secondIdentityId, true);
    expect(response.status, await response.clone().text()).toBe(200);
  });
  it("refuses a different account or a scope-limited MCP session", async () => {
    const f = await proposalIdentityFixture();
    const outsider = await insertUser(env.DB, "outsider@other-work.test");
    const response = await correct(f, await createAdminSession(env.DB, outsider, crypto.randomUUID()));
    expect(response.status).toBe(409);
    const actor = await staff();
    const limited = await createMcpSession(env.DB, { id: actor.id, email: "admin@pkic.org" }, crypto.randomUUID(), [
      "membership:read",
    ]);
    expect((await correct(f, limited, f.secondIdentityId, true)).status).toBe(409);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBe(
      f.identityId,
    );
  });
  it("refuses a replacement belonging to another person and leaves event references untouched", async () => {
    const f = await proposalIdentityFixture();
    const id = await registration(f);
    const foreign = await insertOrgRepresentative(env.DB, { email: "different@other-work.test" });
    expect((await correct(f, f.token, foreign.identityId)).status).toBe(409);
    expect(
      await env.DB.prepare("SELECT registration_identity_id FROM registrations WHERE id=?")
        .bind(id)
        .first("registration_identity_id"),
    ).toBe(f.identityId);
  });
  it("rolls back reference transfers when succession records protect the original identity", async () => {
    const f = await proposalIdentityFixture();
    const id = await registration(f);
    const at = nowIso();
    await env.DB.prepare(`INSERT INTO identities(id,user_id,organization_id,source,invited_at,created_at,updated_at,predecessor_identity_id)
      SELECT ?,user_id,organization_id,'staff',?,?,?,id FROM identities WHERE id=?`)
      .bind(crypto.randomUUID(), at, at, at, f.identityId)
      .run();
    const response = await correct(f);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.text()).toContain("require review");
    expect(
      await env.DB.prepare("SELECT registration_identity_id FROM registrations WHERE id=?")
        .bind(id)
        .first("registration_identity_id"),
    ).toBe(f.identityId);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBe(
      f.identityId,
    );
  });
  it("removes an incorrect former association without adding another history entry", async () => {
    const f = await proposalIdentityFixture();
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(nowIso(), f.identityId).run();
    const response = await correct(f);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBeNull();
    expect(
      await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(f.secondIdentityId).first("ended_at"),
    ).toBeNull();
  });
  it.each(["ended", "future"] as const)("rejects a %s replacement without losing the original", async (state) => {
    const f = await proposalIdentityFixture();
    await env.DB.prepare(`UPDATE identities SET ${state === "ended" ? "ended_at" : "started_at"}=? WHERE id=?`)
      .bind(state === "ended" ? nowIso() : "2099-01-01T00:00:00.000Z", f.secondIdentityId)
      .run();
    expect((await correct(f)).status).toBe(409);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBe(
      f.identityId,
    );
  });
  it("keeps owner and staff selector pages bounded and scoped in one batch", async () => {
    const f = await proposalIdentityFixture();
    const own = await callApi(
      env,
      `/api/v1/users/current/identities?organizationOnly=true&excludeIdentityId=${f.identityId}&limit=1`,
      { headers: { authorization: `Bearer ${f.token}` } },
      { maxRoundTrips: 1 },
    );
    expect(own.status, await own.clone().text()).toBe(200);
    expect(identitiesListResponseSchema.parse(await own.json()).identities.map((identity) => identity.id)).toEqual([
      f.secondIdentityId,
    ]);
    const actor = await staff();
    const page = await callApi(
      env,
      `/api/v1/identities?userId=${f.userId}&organizationOnly=true&excludeIdentityId=${f.identityId}&limit=1`,
      { headers: { authorization: `Bearer ${actor.token}` } },
      { maxRoundTrips: 1 },
    );
    expect(page.status, await page.clone().text()).toBe(200);
    expect(identitiesListResponseSchema.parse(await page.json()).identities.map((identity) => identity.id)).toEqual([
      f.secondIdentityId,
    ]);
  });
});

describe("identity deletion", () => {
  async function remove(f: Fixture, token: string, identityId = f.identityId, machine = false) {
    return callApi(
      env,
      `/api/v1/users/${f.userId}/identities/${identityId}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, ...(machine ? { "x-pkic-machine-auth": "mcp" } : {}) },
      },
      { maxRoundTrips: 1 },
    );
  }
  it.each(["owner", "staff"])(
    "lets the %s delete an unused organization identity through the same endpoint",
    async (mode) => {
      const f = await proposalIdentityFixture();
      const token = mode === "owner" ? f.token : (await staff()).token;
      const response = await remove(f, token);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBeNull();
      expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.secondIdentityId).first("id")).toBe(
        f.secondIdentityId,
      );
    },
  );
  it("refuses deletion with participation references and rolls back the removal", async () => {
    const f = await proposalIdentityFixture();
    const id = await registration(f);
    const response = await remove(f, (await staff()).token);
    expect(response.status).toBe(409);
    expect(
      await env.DB.prepare("SELECT registration_identity_id FROM registrations WHERE id=?")
        .bind(id)
        .first("registration_identity_id"),
    ).toBe(f.identityId);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBe(
      f.identityId,
    );
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM audit_log WHERE action='incorrect_representation_removed'",
      ).first("count"),
    ).toBe(0);
  });
  it("deletes an unused personal identity without deleting its user account", async () => {
    const f = await proposalIdentityFixture();
    f.userId = await insertUser(env.DB, "personal-only@example.test");
    f.token = await createAdminSession(env.DB, f.userId, crypto.randomUUID());
    const personalId = await personalIdentity(f.userId);
    expect((await remove(f, (await staff()).token, personalId)).status).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(personalId).first("id")).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(f.userId).first("id")).toBe(f.userId);
    const session = await callApi(env, "/api/v1/auth/session", {
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(session.status, await session.clone().text()).toBe(200);
    const account = userAuthSessionResponseSchema.parse(await session.json());
    expect(account.identity.id).toBe(f.userId);
    expect(account.actingIdentities).toHaveLength(0);
  });
  it("refuses another account and an insufficient delegated scope", async () => {
    const f = await proposalIdentityFixture();
    const outsider = await insertUser(env.DB, "deletion-outsider@example.test");
    expect((await remove(f, await createAdminSession(env.DB, outsider, crypto.randomUUID()))).status).toBe(409);
    const actor = await staff();
    const token = await createMcpSession(env.DB, { id: actor.id, email: "admin@pkic.org" }, crypto.randomUUID(), [
      "membership:write",
    ]);
    expect((await remove(f, token, f.identityId, true)).status).toBe(409);
    expect(await env.DB.prepare("SELECT id FROM identities WHERE id=?").bind(f.identityId).first("id")).toBe(
      f.identityId,
    );
  });
});
