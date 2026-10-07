import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  eventProposalProofStartSchema,
  eventProposalProofVerifySchema,
  eventProposalProofVerifyResponseSchema,
  eventProposalProofIdentitiesSchema,
  eventProposalProofIdentityPatchSchema,
} from "../assets/shared/schemas/event-proposal-proof";
import { speakerSelfProfilePatchSchema } from "../assets/shared/schemas/proposal-management";
import { speakerProfileUpdateResponseSchema } from "../assets/shared/schemas/speaker-self-service";
import { identitiesListResponseSchema } from "../assets/shared/schemas/identity";
import { verifyEventProposalCapability } from "../functions/_lib/services/event-proposal-proof-capabilities";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import type { DatabaseLike } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { insertOrganization, insertUser } from "./helpers/membership";
import { prepareProposalProof } from "./helpers/proposal-proof";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
const base = "/api/v1/events/pqc-2026/proposals/proof";
const consents = [{ termKey: "speaker-terms", version: "v1" }];
async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const userId = await insertUser(env.DB, "speaker@gmail.com");
  await env.DB.prepare("UPDATE users SET email_verified_at=?,last_name='Speaker' WHERE id=?")
    .bind(new Date().toISOString(), userId)
    .run();
  const proposalId = crypto.randomUUID();
  const speakerId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO session_proposals
      (id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at)
      VALUES(?,?,?,'accepted','talk','Owned speaker proof','Canonical authenticated speaker proof fixture',?,datetime('now'),datetime('now'))`,
    ).bind(proposalId, eventId, userId, crypto.randomUUID()),
    env.DB.prepare(
      `INSERT INTO proposal_speakers
      (id,proposal_id,user_id,role,status,manage_link_secret,invite_generation,created_at)
      VALUES(?,?,?,'speaker','confirmed',?,0,datetime('now'))`,
    ).bind(speakerId, proposalId, userId, crypto.randomUUID()),
  ]);
  const session = await createMemberSession(env.DB, userId, crypto.randomUUID());
  const sessionId = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?").bind(userId).first<string>("id");
  const otherSession = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const organizationId = await insertOrganization(env.DB, "Verified Employer");
  await env.DB.prepare(
    `INSERT INTO organization_domain_claims
    (id,domain,organization_id,application_id,created_at,updated_at)
    VALUES(?,'official.example',?,NULL,datetime('now'),datetime('now'))`,
  )
    .bind(crypto.randomUUID(), organizationId)
    .run();
  return { eventId, userId, proposalId, speakerId, session, sessionId, otherSession, organizationId };
}
function request(path: string, body: unknown, session?: string, db: DatabaseLike = env.DB, method = "POST") {
  return callApi({ ...env, DB: db }, path, {
    method,
    headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: JSON.stringify(body),
  });
}
async function mailToken(email: string) {
  const rows = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email=? ORDER BY rowid DESC LIMIT 1",
    email,
  );
  const mail = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, rows[0].payload_json);
  const url = new URL(mail.verificationUrl);
  const token = new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1)).get("verify");
  if (!token) throw new Error("The actual speaker email must contain its portal verification parameter");
  return { token, url };
}
async function start(f: Awaited<ReturnType<typeof fixture>>, email = "speaker@official.example") {
  const response = await request(
    base,
    eventProposalProofStartSchema.parse({ email, consents, speakerProposalId: f.proposalId }),
    f.session,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const mail = await mailToken(email);
  expect(mail.url.hash.split("?")[0]).toBe(`#/events/pqc-2026/proposals/${f.proposalId}/participation`);
  return mail.token;
}
async function ready(f: Awaited<ReturnType<typeof fixture>>) {
  const token = await start(f);
  const response = await request(
    `${base}/verify`,
    eventProposalProofVerifySchema.parse({ token, speakerProposalId: f.proposalId }),
    f.session,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const result = eventProposalProofVerifyResponseSchema.parse(await response.json());
  if (result.status !== "ready") throw new Error("Expected an owned speaker mailbox confirmation");
  expect(result.speakerProposalId).toBe(f.proposalId);
  expect(result.speakerManagementToken).toBeUndefined();
  expect(new URL(result.speakerManageUrl!).hash).toBe(`#/events/pqc-2026/proposals/${f.proposalId}/participation`);
  const payload = await verifyEventProposalCapability(
    env.INTERNAL_SIGNING_SECRET!,
    result.continuationToken,
    f.eventId,
    true,
  );
  expect(payload.operation).toBe("speaker_profile");
  expect(payload.context).toMatchObject({
    kind: "speaker",
    speakerId: f.speakerId,
    userId: f.userId,
    sessionId: f.sessionId,
  });
  return result;
}
async function state() {
  const tables = [
    "sessions",
    "users",
    "user_emails",
    "identities",
    "proposal_speakers",
    "session_proposals",
    "audit_log",
    "email_outbox",
    "consent_acceptances",
  ];
  return Promise.all(tables.map((table) => queryAll(env.DB, `SELECT * FROM ${table} ORDER BY id`)));
}
async function profile(f: Awaited<ReturnType<typeof fixture>>, continuationToken: string, db: DatabaseLike = env.DB) {
  return request(
    `/api/v1/proposals/${f.proposalId}/participation/profile`,
    speakerSelfProfilePatchSchema.parse({
      continuationToken,
      unaffiliatedAttestation: false,
      consents,
      jobTitle: "Verified role",
    }),
    f.session,
    db,
    "PATCH",
  );
}

describe("authenticated speaker resource mailbox proof", () => {
  it("proves the exact secondary mailbox and records the owned representation without a manage token or duplicate person", async () => {
    const f = await fixture();
    const proof = await ready(f);
    expect(await queryAll(env.DB, "SELECT id FROM user_emails")).toHaveLength(0);
    const saved = await profile(f, proof.continuationToken);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const result = speakerProfileUpdateResponseSchema.parse(await saved.json());
    expect(result.currentRepresentation?.actingIdentityId).toBeTruthy();
    const alias = await env.DB.prepare(
      "SELECT id,user_id,verified_at FROM user_emails WHERE normalized_email='speaker@official.example'",
    ).first<{ id: string; user_id: string; verified_at: string }>();
    expect(alias).toMatchObject({ user_id: f.userId });
    expect(alias?.verified_at).toBeTruthy();
    expect(
      await queryAll(env.DB, "SELECT user_id,organization_id,email_id FROM identities WHERE user_id=?", f.userId),
    ).toEqual([{ user_id: f.userId, organization_id: f.organizationId, email_id: alias!.id }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email='speaker@official.example'"),
    ).toHaveLength(0);
    const fresh = await ready(f);
    const catalog = await request(
      `${base}/identities`,
      eventProposalProofIdentitiesSchema.parse({
        continuationToken: fresh.continuationToken,
        speakerProposalId: f.proposalId,
      }),
      f.session,
    );
    expect(catalog.status, await catalog.clone().text()).toBe(200);
    const identities = identitiesListResponseSchema.parse(await catalog.json());
    expect(identities.identities.map((identity) => identity.id)).toContain(
      result.currentRepresentation!.actingIdentityId,
    );
    const role = await request(
      `${base}/identities/${result.currentRepresentation!.actingIdentityId}`,
      eventProposalProofIdentityPatchSchema.parse({
        continuationToken: fresh.continuationToken,
        speakerProposalId: f.proposalId,
        jobTitle: "Updated own role",
      }),
      f.session,
      env.DB,
      "PATCH",
    );
    expect(role.status, await role.clone().text()).toBe(200);
    const frozen = await env.DB.prepare("SELECT acting_identity_snapshot_json FROM proposal_speakers WHERE id=?")
      .bind(f.speakerId)
      .first<string>("acting_identity_snapshot_json");
    expect(JSON.parse(frozen!).jobTitle).toBe("Verified role");
  });

  it("retains invited guest mailbox proof and exact management-token redemption", async () => {
    const f = await fixture();
    const token = await issueDatabaseCapability({
      db: env.DB,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "speaker_manage",
      resourceId: f.speakerId,
    });
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "speaker@official.example",
      consents,
      unaffiliatedAttestation: false,
      speakerManagementToken: token,
    });
    expect(proof.speakerManagementToken).toBeTruthy();
    const response = await request(
      `/api/v1/proposals/speakers/access/${proof.speakerManagementToken}/profile`,
      speakerSelfProfilePatchSchema.parse({
        continuationToken: proof.continuationToken,
        unaffiliatedAttestation: false,
        consents,
        jobTitle: "Invited role",
      }),
      undefined,
      env.DB,
      "PATCH",
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = speakerProfileUpdateResponseSchema.parse(await response.json());
    expect(saved.currentRepresentation?.actingIdentityId).toBeTruthy();
  });

  it.each(["anonymous", "other_owner", "other_event", "ambiguous"] as const)(
    "refuses %s resource proof before queuing email",
    async (kind) => {
      const f = await fixture();
      let path = base;
      if (kind === "other_event") {
        await env.DB.prepare(
          "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,'foreign','Foreign','UTC','{}',datetime('now'),datetime('now'))",
        )
          .bind(crypto.randomUUID())
          .run();
        path = "/api/v1/events/foreign/proposals/proof";
      }
      const token =
        kind === "ambiguous"
          ? await issueDatabaseCapability({
              db: env.DB,
              signingSecret: env.INTERNAL_SIGNING_SECRET!,
              purpose: "speaker_manage",
              resourceId: f.speakerId,
            })
          : undefined;
      const before = await state();
      const response = await request(
        path,
        {
          email: "speaker@official.example",
          consents: kind === "other_event" ? [] : consents,
          speakerProposalId: f.proposalId,
          speakerManagementToken: token,
        },
        kind === "anonymous" ? undefined : kind === "other_owner" ? f.otherSession : f.session,
      );
      expect(response.status).toBe(
        kind === "anonymous" ? 401 : kind === "other_owner" ? 404 : kind === "other_event" ? 403 : 422,
      );
      expect(await state()).toEqual(before);
    },
  );

  it.each(["missing_resource", "other_owner", "new_session", "other_resource"] as const)(
    "refuses %s on the verified resource continuation",
    async (kind) => {
      const f = await fixture();
      const proof = await ready(f);
      const session =
        kind === "other_owner"
          ? f.otherSession
          : kind === "new_session"
            ? await createMemberSession(env.DB, f.userId, crypto.randomUUID())
            : f.session;
      const before = await state();
      const response = await request(
        `${base}/identities`,
        {
          continuationToken: proof.continuationToken,
          ...(kind !== "missing_resource"
            ? { speakerProposalId: kind === "other_resource" ? crypto.randomUUID() : f.proposalId }
            : {}),
        },
        session,
      );
      expect(response.status).toBe(kind === "other_resource" ? 404 : 403);
      expect(await state()).toEqual(before);
    },
  );

  it("refuses a generic proposal proof at the speaker profile and bound catalog without writes", async () => {
    const f = await fixture();
    const response = await request(base, { email: "speaker@official.example", consents }, f.session);
    expect(response.status).toBe(200);
    const row = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' ORDER BY rowid DESC LIMIT 1",
      )
    )[0];
    const mail = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, row.payload_json);
    const token = new URLSearchParams(new URL(mail.verificationUrl).hash.slice(1)).get("verify");
    const verified = await request(`${base}/verify`, { token }, f.session);
    const proof = eventProposalProofVerifyResponseSchema.parse(await verified.json());
    if (proof.status !== "ready") throw new Error("Expected ordinary proposal proof");
    const before = await state();
    expect((await profile(f, proof.continuationToken)).status).toBe(403);
    expect(
      (
        await request(
          `${base}/identities`,
          { continuationToken: proof.continuationToken, speakerProposalId: f.proposalId },
          f.session,
        )
      ).status,
    ).toBe(403);
    expect(await state()).toEqual(before);
  });

  it.each(["session", "generation"] as const)(
    "rolls back final speaker selection when %s changes at its write batch",
    async (kind) => {
      const f = await fixture();
      const proof = await ready(f);
      let reached = false;
      let concurrent: Awaited<ReturnType<typeof state>> | undefined;
      const db = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("UPDATE proposal_speakers SET profile_overrides_json"),
        async () => {
          reached = true;
          if (kind === "session")
            await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?")
              .bind(new Date().toISOString(), f.sessionId)
              .run();
          else
            await env.DB.prepare("UPDATE proposal_speakers SET invite_generation=invite_generation+1 WHERE id=?")
              .bind(f.speakerId)
              .run();
          concurrent = await state();
        },
      );
      const response = await profile(f, proof.continuationToken, db);
      expect(reached).toBe(true);
      expect(response.status, await response.clone().text()).toBe(409);
      expect(await state()).toEqual(concurrent);
      expect(await queryAll(env.DB, "SELECT id FROM user_emails")).toHaveLength(0);
      expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", f.userId)).toHaveLength(0);
    },
  );
});
