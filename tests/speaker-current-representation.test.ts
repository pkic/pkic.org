import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { speakerSelfProfilePatchSchema } from "../assets/shared/schemas/proposal-management";
import {
  speakerProfileUpdateResponseSchema,
  speakerSelfServiceReadResponseSchema,
} from "../assets/shared/schemas/speaker-self-service";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const email = "person@personal.example";
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare(
    `UPDATE users SET first_name='Known',last_name='Speaker',email_verified_at=?,
      biography='Account biography',links_json='["https://account.example"]' WHERE id=?`,
  )
    .bind(new Date().toISOString(), userId)
    .run();
  const proposalId = crypto.randomUUID();
  const speakerId = crypto.randomUUID();
  const secret = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO session_proposals
       (id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at)
       VALUES (?, ?, ?, 'accepted', 'talk', 'Current representation', 'A speaker identity read fixture.', ?, datetime('now'), datetime('now'))`,
    ).bind(proposalId, eventId, userId, crypto.randomUUID()),
    env.DB.prepare(
      `INSERT INTO proposal_speakers
       (id,proposal_id,user_id,role,status,manage_link_secret,invite_generation,invite_expires_at,created_at)
       VALUES (?, ?, ?, 'speaker', 'confirmed', ?, 0, ?, datetime('now'))`,
    ).bind(speakerId, proposalId, userId, secret, new Date(Date.now() + 86400000).toISOString()),
  ]);
  const token = await issueDatabaseCapability({
    db: env.DB,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "speaker_manage",
    resourceId: speakerId,
  });
  return { userId, email, speakerId, secret, path: `/api/v1/proposals/speakers/access/${encodeURIComponent(token)}` };
}

async function organizationIdentity(userId: string, secondary = true, name = "Current Employer") {
  const organizationId = await insertOrganization(env.DB, name);
  const emailId = secondary ? crypto.randomUUID() : null;
  const email = "person@work.example";
  if (emailId) {
    await env.DB.prepare(
      `INSERT INTO user_emails
       (id,user_id,email,normalized_email,verified_at,verification_method,created_at)
       VALUES (?, ?, ?, ?, ?, 'magic_link', ?)`,
    )
      .bind(emailId, userId, email, email, new Date().toISOString(), new Date().toISOString())
      .run();
  }
  const prepared = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId,
    emailId,
    source: "staff",
    jobTitle: "Recorded role",
    biography: "Identity biography",
    linksJson: '["https://identity.example"]',
    startImmediately: true,
  });
  await env.DB.batch([prepared.statement]);
  return { identityId: prepared.identityId, organizationId, emailId, email };
}

async function read(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await callApi(env, f.path);
  expect(response.status, await response.clone().text()).toBe(200);
  return speakerSelfServiceReadResponseSchema.parse(await response.json());
}

async function patch(f: Awaited<ReturnType<typeof fixture>>, body: unknown, session?: string) {
  return callApi(env, `${f.path}/profile`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: JSON.stringify(speakerSelfProfilePatchSchema.parse(body)),
  });
}

async function select(f: Awaited<ReturnType<typeof fixture>>, identityId: string | null) {
  const session = await createMemberSession(env.DB, f.userId, crypto.randomUUID(), undefined, identityId);
  const response = await patch(f, { actingIdentityId: identityId }, session);
  expect(response.status, await response.clone().text()).toBe(200);
  return speakerProfileUpdateResponseSchema.parse(await response.json());
}

describe("speaker current representation", () => {
  it("returns the selected verified work mailbox and keeps live identity edits separate from recorded appearance", async () => {
    const f = await fixture();
    const identity = await organizationIdentity(f.userId);
    const selected = await select(f, identity.identityId);
    expect(selected.currentRepresentation).toMatchObject({
      actingIdentityId: identity.identityId,
      actingIdentitySelection: "identity",
      emailId: identity.emailId,
      email: identity.email,
      organizationId: identity.organizationId,
      organizationName: "Current Employer",
      jobTitle: "Recorded role",
      biography: "Identity biography",
      links: ["https://identity.example"],
    });
    expect(selected.profile).toMatchObject({ email: f.email, jobTitle: "Recorded role" });
    await env.DB.prepare("UPDATE identities SET job_title='Current role',updated_at=? WHERE id=?")
      .bind(new Date().toISOString(), identity.identityId)
      .run();
    const current = await read(f);
    expect(current.currentRepresentation).toMatchObject({ email: identity.email, jobTitle: "Current role" });
    expect(current.profile).toEqual(selected.profile);
    const saved = await patch(f, { biography: "New speaker appearance biography" });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const receipt = speakerProfileUpdateResponseSchema.parse(await saved.json());
    expect(receipt.profile).toMatchObject({ jobTitle: "Recorded role", biography: "New speaker appearance biography" });
    expect(receipt.currentRepresentation).toMatchObject({ jobTitle: "Current role", biography: "Identity biography" });
    expect(await read(f)).toMatchObject({
      profile: receipt.profile,
      currentRepresentation: receipt.currentRepresentation,
    });
  });

  it("does not recover a selected unverified work mailbox from the account primary address", async () => {
    const f = await fixture();
    const identity = await organizationIdentity(f.userId);
    const selected = await select(f, identity.identityId);
    await env.DB.prepare("UPDATE user_emails SET verified_at=NULL WHERE id=?").bind(identity.emailId).run();
    const current = await read(f);
    expect(current.currentRepresentation).toBeNull();
    expect(current.profile).toEqual(selected.profile);
    expect(current.profile.actingIdentitySelection).toBe("identity");
  });

  it.each(["ended", "blocked", "future", "inactive"] as const)(
    "does not expose a %s selected identity as current",
    async (state) => {
      const f = await fixture();
      const identity = await organizationIdentity(f.userId);
      const selected = await select(f, identity.identityId);
      const at = new Date().toISOString();
      if (state === "inactive") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.userId).run();
      else if (state === "future") {
        await env.DB.prepare("UPDATE identities SET started_at=? WHERE id=?")
          .bind(new Date(Date.now() + 3600000).toISOString(), identity.identityId)
          .run();
      } else {
        await env.DB.prepare(`UPDATE identities SET ended_at=?,blocked_at=? WHERE id=?`)
          .bind(at, state === "blocked" ? at : null, identity.identityId)
          .run();
      }
      const current = await read(f);
      expect(current.currentRepresentation).toBeNull();
      expect(current.profile).toEqual(selected.profile);
    },
  );

  it("distinguishes an explicit verified individual from unrecorded or unverified representation", async () => {
    const f = await fixture();
    expect((await read(f)).currentRepresentation).toBeNull();
    const selected = await select(f, null);
    expect(selected.currentRepresentation).toMatchObject({
      actingIdentitySelection: "individual",
      actingIdentityId: null,
      emailId: null,
      email: f.email,
      organizationId: null,
      organizationName: null,
      jobTitle: null,
      biography: "Account biography",
      links: ["https://account.example"],
    });
    expect(selected.currentRepresentation?.actingIdentitySelectedAt).not.toBeNull();
    await env.DB.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").bind(f.userId).run();
    const unavailable = await read(f);
    expect(unavailable.currentRepresentation).toBeNull();
    expect(unavailable.profile).toEqual(selected.profile);
  });

  it("requires primary mailbox verification for identities without a selected secondary address", async () => {
    const f = await fixture();
    const identity = await organizationIdentity(f.userId, false);
    const selected = await select(f, identity.identityId);
    expect(selected.currentRepresentation).toMatchObject({ emailId: null, email: f.email });
    await env.DB.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").bind(f.userId).run();
    expect((await read(f)).currentRepresentation).toBeNull();
  });

  it("refuses a foreign identity selection and retains the exact own representation", async () => {
    const f = await fixture();
    const own = await organizationIdentity(f.userId);
    const selected = await select(f, own.identityId);
    const foreignUserId = await insertUser(env.DB, "foreign@personal.example");
    const foreign = await organizationIdentity(foreignUserId, false, "Foreign Employer");
    const session = await createMemberSession(env.DB, f.userId, crypto.randomUUID(), undefined, own.identityId);
    const refused = await patch(f, { actingIdentityId: foreign.identityId }, session);
    expect(refused.status).toBe(403);
    const current = await read(f);
    expect(current.currentRepresentation).toEqual(selected.currentRepresentation);
    expect(current.profile).toEqual(selected.profile);
    expect(JSON.stringify(current)).not.toContain("foreign@personal.example");
    expect(JSON.stringify(current)).not.toContain(f.secret);
    expect(JSON.stringify(current)).not.toContain("manage_link_secret");
  });
});
