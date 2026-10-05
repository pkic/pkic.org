import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  speakerSelfProfilePatchSchema,
  speakerParticipationPatchSchema,
} from "../assets/shared/schemas/proposal-management";
import { speakerSelfServiceReadResponseSchema } from "../assets/shared/schemas/speaker-self-service";
import { getRequiredTerms } from "../functions/_lib/services/events";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import {
  eventProposalProofRedemptionKey,
  issueEventProposalContinuation,
  proposalTermsDigest,
  type EventProposalContinuationPayload,
} from "../functions/_lib/services/event-proposal-proof-capabilities";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { getSpeakerByManageToken } from "../functions/_lib/services/proposals";
import { getEventParticipantSourceRevision } from "../functions/_lib/services/event-participant-source-revision";
import { getProposalSpeakerRosterRevision } from "../functions/_lib/services/proposal-speaker-roster-revision";
import {
  updateSpeakerProfile,
  confirmSpeakerParticipation,
} from "../functions/_lib/services/proposals-speaker-profile";
import { parseCapabilityToken } from "../functions/_lib/auth/capability-token";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertOrganization, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

async function fixture(email = "guest@speaker-employer.example", status: "confirmed" | "pending" = "confirmed") {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare(
    "UPDATE users SET first_name='Known',last_name='Speaker',biography='Account biography',links_json='[\"https://account.example\"]' WHERE id=?",
  )
    .bind(userId)
    .run();
  const proposalId = crypto.randomUUID();
  const speakerId = crypto.randomUUID();
  const secret = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO session_proposals
      (id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at)
      VALUES (?, ?, ?, 'accepted', 'talk', 'Speaker proof fixture', 'An accepted proposal used to verify speaker profile authority.', ?, datetime('now'), datetime('now'))`,
    ).bind(proposalId, eventId, userId, crypto.randomUUID()),
    env.DB.prepare(
      `INSERT INTO proposal_speakers
      (id,proposal_id,user_id,role,status,manage_link_secret,invite_generation,invite_expires_at,created_at)
      VALUES (?, ?, ?, 'speaker', ?, ?, 0, ?, datetime('now'))`,
    ).bind(speakerId, proposalId, userId, status, secret, new Date(Date.now() + 86400000).toISOString()),
  ]);
  const token = await issueDatabaseCapability({
    db: env.DB,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "speaker_manage",
    resourceId: speakerId,
  });
  const path = `/api/v1/proposals/speakers/access/${encodeURIComponent(token)}`;
  return {
    eventId,
    userId,
    email,
    proposalId,
    speakerId,
    secret,
    token,
    path,
    expiresAt: parseCapabilityToken(token, "speaker_manage")!.expiresAt,
  };
}

async function claimedOrganization() {
  const organizationId = await insertOrganization(env.DB, "Canonical Employer");
  await env.DB.prepare(
    `INSERT INTO organization_domain_claims
    (id,domain,organization_id,application_id,created_at,updated_at)
    VALUES (?, 'speaker-employer.example', ?, NULL, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), organizationId)
    .run();
  return organizationId;
}

async function proof(
  f: Awaited<ReturnType<typeof fixture>>,
  overrides: Partial<EventProposalContinuationPayload> = {},
) {
  const payload: EventProposalContinuationPayload = {
    eventId: f.eventId,
    email: f.email,
    userId: f.userId,
    applicantKind: "organization",
    capabilityId: crypto.randomUUID(),
    termsDigest: await proposalTermsDigest(await getRequiredTerms(env.DB, f.eventId, "speaker")),
    operation: "speaker_profile",
    context: {
      kind: "speaker",
      userId: f.userId,
      speakerId: f.speakerId,
      inviteGeneration: 0,
      expiresAt: f.expiresAt,
      secretDigest: await sha256Hex(f.secret),
    },
    ...overrides,
  };
  return {
    payload,
    token: await issueEventProposalContinuation(
      env.INTERNAL_SIGNING_SECRET!,
      payload,
      Math.floor(Date.now() / 1000) + 3600,
    ),
  };
}

async function patch(f: Awaited<ReturnType<typeof fixture>>, body: unknown, sessionToken?: string) {
  const parsed = speakerSelfProfilePatchSchema.parse(body);
  return callApi(env, `${f.path}/profile`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify(parsed),
  });
}

async function speakerState(speakerId: string) {
  return env.DB.prepare(
    "SELECT acting_identity_id,acting_identity_selected_at,acting_identity_snapshot_json,profile_overrides_json,status,role FROM proposal_speakers WHERE id=?",
  )
    .bind(speakerId)
    .first();
}

async function identity(userId: string, organizationId: string) {
  const prepared = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId,
    source: "staff",
    jobTitle: "Canonical role",
    biography: "Canonical biography",
    linksJson: '["https://identity.example"]',
    startImmediately: true,
  });
  await env.DB.batch([prepared.statement]);
  return prepared.identityId;
}

describe("speaker affiliation mailbox proof", () => {
  it("creates the same guest's canonical affiliation and snapshot without rewriting known account details", async () => {
    const f = await fixture();
    const organizationId = await claimedOrganization();
    const p = await proof(f);
    const response = await patch(f, {
      continuationToken: p.token,
      unaffiliatedAttestation: false,
      jobTitle: "Verified speaker role",
      firstName: "Duplicate name",
      lastName: "Duplicate surname",
      biography: "Proposal biography",
      links: ["https://proposal.example"],
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const selected = await env.DB.prepare("SELECT id,email_id,organization_id FROM identities WHERE user_id=?")
      .bind(f.userId)
      .first<{ id: string; email_id: string | null; organization_id: string }>();
    expect(selected).toMatchObject({ organization_id: organizationId, email_id: null });
    const read = speakerSelfServiceReadResponseSchema.parse(await (await callApi(env, f.path)).json());
    expect(read.profile).toMatchObject({
      firstName: "Known",
      lastName: "Speaker",
      actingIdentityId: selected!.id,
      organizationName: "Canonical Employer",
      jobTitle: "Verified speaker role",
      biography: "Proposal biography",
      links: ["https://proposal.example"],
    });
    expect(
      await env.DB.prepare(
        "SELECT first_name,last_name,organization_name,biography,links_json,email_verified_at FROM users WHERE id=?",
      )
        .bind(f.userId)
        .first(),
    ).toMatchObject({
      first_name: "Known",
      last_name: "Speaker",
      organization_name: null,
      biography: "Account biography",
      links_json: '["https://account.example"]',
    });
    expect(await speakerState(f.speakerId)).toMatchObject({ status: "confirmed", role: "speaker" });
    const replay = await patch(f, { continuationToken: p.token, unaffiliatedAttestation: false });
    expect(replay.status).toBe(409);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE idempotency_key=?")
        .bind(eventProposalProofRedemptionKey(p.payload.capabilityId))
        .first("count"),
    ).toBe(1);
  });

  it("uses existing identity information for a logged-in owner without requiring duplicate profile fields", async () => {
    const f = await fixture();
    const identityId = await identity(f.userId, await claimedOrganization());
    await env.DB.prepare("UPDATE proposal_speakers SET profile_overrides_json=? WHERE id=?")
      .bind(
        JSON.stringify({
          firstName: "Previous override",
          organizationName: "Previous employer",
          jobTitle: "Previous role",
          biography: "Previous biography",
          links: ["https://previous.example"],
        }),
        f.speakerId,
      )
      .run();
    const sessionToken = await createMemberSession(env.DB, f.userId, crypto.randomUUID(), undefined, identityId);
    const response = await patch(
      f,
      { actingIdentityId: identityId, firstName: "Repeated form name", lastName: "Repeated form surname" },
      sessionToken,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const read = speakerSelfServiceReadResponseSchema.parse(await (await callApi(env, f.path)).json());
    expect(read.profile).toMatchObject({
      firstName: "Known",
      lastName: "Speaker",
      organizationName: "Canonical Employer",
      jobTitle: "Canonical role",
      biography: "Canonical biography",
      links: ["https://identity.example"],
    });
  });

  it("refuses another owner's identity and leaves a valid speaker proof reusable", async () => {
    const f = await fixture();
    const organizationId = await claimedOrganization();
    const foreignUserId = await insertUser(env.DB, "foreign@speaker-employer.example");
    const foreignIdentityId = await identity(foreignUserId, organizationId);
    const ownIdentityId = await identity(f.userId, organizationId);
    const p = await proof(f);
    const refused = await patch(f, {
      continuationToken: p.token,
      actingIdentityId: foreignIdentityId,
      unaffiliatedAttestation: false,
    });
    expect(refused.status).toBe(403);
    expect(await speakerState(f.speakerId)).toMatchObject({ acting_identity_id: null });
    const accepted = await patch(f, {
      continuationToken: p.token,
      actingIdentityId: ownIdentityId,
      unaffiliatedAttestation: false,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
  });

  it.each(["initial_proposal", "other_speaker", "other_event", "old_generation"] as const)(
    "rejects %s confirmation context",
    async (kind) => {
      const f = await fixture();
      await claimedOrganization();
      const overrides: Partial<EventProposalContinuationPayload> =
        kind === "initial_proposal"
          ? { operation: "proposal_submission", context: null }
          : kind === "other_speaker"
            ? {
                context: {
                  kind: "speaker",
                  userId: f.userId,
                  speakerId: crypto.randomUUID(),
                  inviteGeneration: 0,
                  expiresAt: f.expiresAt,
                  secretDigest: await sha256Hex(f.secret),
                },
              }
            : kind === "other_event"
              ? { eventId: crypto.randomUUID() }
              : {
                  context: {
                    kind: "speaker",
                    userId: f.userId,
                    speakerId: f.speakerId,
                    inviteGeneration: 1,
                    expiresAt: f.expiresAt,
                    secretDigest: await sha256Hex(f.secret),
                  },
                };
      const p = await proof(f, overrides);
      const response = await patch(f, { continuationToken: p.token, unaffiliatedAttestation: false });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await speakerState(f.speakerId)).toMatchObject({
        acting_identity_id: null,
        acting_identity_selected_at: null,
      });
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE idempotency_key=?")
          .bind(eventProposalProofRedemptionKey(p.payload.capabilityId))
          .first("count"),
      ).toBe(0);
    },
  );

  it("binds a newly verified secondary work mailbox to the invited person rather than a second account", async () => {
    const f = await fixture("guest@gmail.com");
    const organizationId = await claimedOrganization();
    const email = "guest@speaker-employer.example";
    const p = await proof(f, { email });
    const response = await patch(f, { continuationToken: p.token, unaffiliatedAttestation: false });
    expect(response.status, await response.clone().text()).toBe(200);
    const address = await env.DB.prepare("SELECT id,user_id,verified_at FROM user_emails WHERE normalized_email=?")
      .bind(email)
      .first<{ id: string; user_id: string; verified_at: string }>();
    expect(address?.user_id).toBe(f.userId);
    expect(address?.verified_at).toBeTruthy();
    expect(
      await env.DB.prepare("SELECT organization_id,email_id FROM identities WHERE user_id=?").bind(f.userId).first(),
    ).toMatchObject({ organization_id: organizationId, email_id: address!.id });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE normalized_email=?").bind(email).first("count"),
    ).toBe(0);
  });

  it("refuses a work mailbox belonging to another person without merging or changing the speaker", async () => {
    const f = await fixture("guest@gmail.com");
    await claimedOrganization();
    const email = "other@speaker-employer.example";
    const owner = await insertUser(env.DB, email);
    const p = await proof(f, { email });
    const response = await patch(f, { continuationToken: p.token, unaffiliatedAttestation: false });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await env.DB.prepare("SELECT id FROM users WHERE normalized_email=?").bind(email).first("id")).toBe(owner);
    expect(await speakerState(f.speakerId)).toMatchObject({ acting_identity_id: null });
  });

  it.each(["secret", "generation", "profile"] as const)(
    "rolls back mailbox and affiliation changes when %s changes during the save",
    async (race) => {
      const f = await fixture();
      await claimedOrganization();
      const p = await proof(f);
      const context = await getSpeakerByManageToken(env.DB, f.token, env.INTERNAL_SIGNING_SECRET!);
      const racingDb = mutateBeforeNextBatch(env.DB, () =>
        env.DB.prepare(
          race === "secret"
            ? "UPDATE proposal_speakers SET manage_link_secret=? WHERE id=?"
            : race === "generation"
              ? "UPDATE proposal_speakers SET invite_generation=invite_generation+1 WHERE id=?"
              : "UPDATE proposal_speakers SET profile_overrides_json=? WHERE id=?",
        )
          .bind(
            ...(race === "generation"
              ? [f.speakerId]
              : [race === "secret" ? crypto.randomUUID() : '{"biography":"Concurrent profile"}', f.speakerId]),
          )
          .run(),
      );
      await expect(
        updateSpeakerProfile(
          racingDb,
          { continuationToken: p.token, unaffiliatedAttestation: false },
          {
            proposalSpeakerId: f.speakerId,
            proposalId: f.proposalId,
            proposalStatus: context.proposal.status,
            proposalUpdatedAt: context.proposal.updated_at,
            userId: f.userId,
            currentStatus: context.speaker.status,
            inviteGeneration: context.speaker.invite_generation,
            expectedProfileOverridesJson: context.user.proposalProfileOverridesJson,
            expectedActingIdentityId: context.speaker.acting_identity_id,
            expectedActingIdentitySelectedAt: context.speaker.acting_identity_selected_at,
            expectedActingIdentitySnapshotJson: context.speaker.acting_identity_snapshot_json,
            authority: f.token,
            expectedManageLinkSecret: context.speaker.manage_link_secret,
            signingSecret: env.INTERNAL_SIGNING_SECRET!,
          },
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM identities WHERE user_id=?").bind(f.userId).first("count"),
      ).toBe(0);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE idempotency_key=?")
          .bind(eventProposalProofRedemptionKey(p.payload.capabilityId))
          .first("count"),
      ).toBe(0);
      expect(
        await env.DB.prepare("SELECT email_verified_at FROM users WHERE id=?")
          .bind(f.userId)
          .first("email_verified_at"),
      ).toBeNull();
    },
  );

  it("keeps guest biography and link edits available without manufacturing a canonical relationship", async () => {
    const f = await fixture();
    const response = await patch(f, {
      organizationName: "Typed employer",
      jobTitle: "Typed title",
      biography: "Saved guest biography",
      links: ["https://guest.example"],
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const read = speakerSelfServiceReadResponseSchema.parse(await (await callApi(env, f.path)).json());
    expect(read.profile).toMatchObject({
      organizationName: "Typed employer",
      jobTitle: "Typed title",
      biography: "Saved guest biography",
      links: ["https://guest.example"],
      actingIdentitySelection: "unrecorded",
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM identities WHERE user_id=?").bind(f.userId).first("count"),
    ).toBe(0);
    expect(await speakerState(f.speakerId)).toMatchObject({ status: "confirmed", role: "speaker" });
  });

  it("records an explicit individual presentation after personal-mailbox proof and rejects changed qualification", async () => {
    const f = await fixture("individual@gmail.com");
    const p = await proof(f, { applicantKind: "individual" });
    const changed = await patch(f, { continuationToken: p.token, unaffiliatedAttestation: false });
    expect(changed.status).toBe(422);
    const accepted = await patch(f, {
      continuationToken: p.token,
      unaffiliatedAttestation: true,
      actingIdentityId: null,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const read = speakerSelfServiceReadResponseSchema.parse(await (await callApi(env, f.path)).json());
    expect(read.profile).toMatchObject({
      actingIdentityId: null,
      actingIdentitySelection: "individual",
      organizationName: null,
      jobTitle: null,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM identities WHERE user_id=?").bind(f.userId).first("count"),
    ).toBe(0);
  });

  it("does not expose an acting identity catalog through a guest speaker link alone", async () => {
    const f = await fixture();
    await identity(f.userId, await claimedOrganization());
    const response = await callApi(env, `${f.path}/identities`);
    expect(response.status).toBe(401);
    const wrongOwner = await insertUser(env.DB, "wrong-owner@example.test");
    const wrongIdentity = await identity(wrongOwner, await insertOrganization(env.DB, "Other Employer"));
    const session = await createMemberSession(env.DB, wrongOwner, crypto.randomUUID(), undefined, wrongIdentity);
    const forbidden = await patch(f, { actingIdentityId: wrongIdentity }, session);
    expect(forbidden.status).toBe(403);
  });

  it("rolls back known identity selection if its human session expires during the save", async () => {
    const f = await fixture();
    const identityId = await identity(f.userId, await claimedOrganization());
    await createMemberSession(env.DB, f.userId, crypto.randomUUID(), undefined, identityId);
    const sessionId = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1")
      .bind(f.userId)
      .first<string>("id");
    const context = await getSpeakerByManageToken(env.DB, f.token, env.INTERNAL_SIGNING_SECRET!);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(sessionId).run(),
    );
    await expect(
      updateSpeakerProfile(
        racingDb,
        { actingIdentityId: identityId },
        {
          proposalSpeakerId: f.speakerId,
          proposalId: f.proposalId,
          proposalStatus: context.proposal.status,
          proposalUpdatedAt: context.proposal.updated_at,
          userId: f.userId,
          currentStatus: context.speaker.status,
          inviteGeneration: context.speaker.invite_generation,
          expectedProfileOverridesJson: context.user.proposalProfileOverridesJson,
          expectedActingIdentityId: context.speaker.acting_identity_id,
          expectedActingIdentitySelectedAt: context.speaker.acting_identity_selected_at,
          expectedActingIdentitySnapshotJson: context.speaker.acting_identity_snapshot_json,
          authority: f.token,
          expectedManageLinkSecret: context.speaker.manage_link_secret,
          selectionAuthority: { userId: f.userId, sessionId: sessionId! },
        },
      ),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    expect(await speakerState(f.speakerId)).toMatchObject({
      acting_identity_id: null,
      acting_identity_selected_at: null,
    });
  });

  it("refuses an unrecorded guest representation before writing confirmation audit or consents", async () => {
    const f = await fixture("unrecorded@speaker-employer.example", "pending");
    const response = await callApi(env, `${f.path}/participation`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        speakerParticipationPatchSchema.parse({
          status: "confirmed",
          consents: [{ termKey: "speaker-terms", version: "v1" }],
        }),
      ),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: "SPEAKER_REPRESENTATION_REQUIRED",
        message: "Confirm your speaker identity before confirming participation.",
      },
    });
    expect(await speakerState(f.speakerId)).toMatchObject({ status: "pending", acting_identity_selected_at: null });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM consent_acceptances WHERE proposal_id=? AND user_id=?")
        .bind(f.proposalId, f.userId)
        .first("count"),
    ).toBe(0);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id=? AND action='speaker_confirmed'")
        .bind(f.speakerId)
        .first("count"),
    ).toBe(0);
  });

  it.each(["organization", "individual"] as const)("confirms a guest after proved %s selection", async (kind) => {
    const f = await fixture(
      kind === "individual" ? "individual-confirm@gmail.com" : "organization-confirm@speaker-employer.example",
      "pending",
    );
    if (kind === "organization") await claimedOrganization();
    const p = await proof(f, { applicantKind: kind });
    const selected = await patch(f, {
      continuationToken: p.token,
      unaffiliatedAttestation: kind === "individual",
      ...(kind === "individual" ? { actingIdentityId: null } : {}),
    });
    expect(selected.status, await selected.clone().text()).toBe(200);
    const response = await callApi(env, `${f.path}/participation`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        speakerParticipationPatchSchema.parse({
          status: "confirmed",
          consents: [{ termKey: "speaker-terms", version: "v1" }],
        }),
      ),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await speakerState(f.speakerId)).toMatchObject({ status: "confirmed" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM consent_acceptances WHERE proposal_id=? AND user_id=?")
        .bind(f.proposalId, f.userId)
        .first("count"),
    ).toBe(1);
  });

  it("keeps already confirmed historical participation idempotent without guessing a representation", async () => {
    const f = await fixture();
    await expect(
      confirmSpeakerParticipation(env.DB, f.token, env.INTERNAL_SIGNING_SECRET!, {
        consents: [],
        ip: null,
        userAgent: null,
      }),
    ).resolves.toBeUndefined();
    expect(await speakerState(f.speakerId)).toMatchObject({ status: "confirmed", acting_identity_selected_at: null });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id=? AND action='speaker_confirmed'")
        .bind(f.speakerId)
        .first("count"),
    ).toBe(0);
  });

  it("rejects an individual marker carrying an organization snapshot", async () => {
    const f = await fixture("invalid-snapshot@speaker-employer.example", "pending");
    await env.DB.prepare(
      "UPDATE proposal_speakers SET acting_identity_selected_at=?,acting_identity_snapshot_json=? WHERE id=?",
    )
      .bind(
        new Date().toISOString(),
        JSON.stringify({ organizationName: "Unproved employer", jobTitle: null, biography: null, links: [] }),
        f.speakerId,
      )
      .run();
    await expect(
      confirmSpeakerParticipation(env.DB, f.token, env.INTERNAL_SIGNING_SECRET!, {
        consents: [{ termKey: "speaker-terms", version: "v1" }],
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ status: 409, code: "SPEAKER_REPRESENTATION_REQUIRED" });
    expect(await speakerState(f.speakerId)).toMatchObject({ status: "pending" });
  });

  it("rolls back confirmation if the selected organization identity ends after preflight", async () => {
    const f = await fixture("confirmation-race@speaker-employer.example", "pending");
    await claimedOrganization();
    const p = await proof(f);
    const selected = await patch(f, { continuationToken: p.token, unaffiliatedAttestation: false });
    expect(selected.status, await selected.clone().text()).toBe(200);
    const identityId = await env.DB.prepare("SELECT acting_identity_id FROM proposal_speakers WHERE id=?")
      .bind(f.speakerId)
      .first<string>("acting_identity_id");
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(new Date().toISOString(), identityId).run(),
    );
    await expect(
      confirmSpeakerParticipation(racingDb, f.token, env.INTERNAL_SIGNING_SECRET!, {
        consents: [{ termKey: "speaker-terms", version: "v1" }],
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await speakerState(f.speakerId)).toMatchObject({ status: "pending" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM consent_acceptances WHERE proposal_id=? AND user_id=?")
        .bind(f.proposalId, f.userId)
        .first("count"),
    ).toBe(0);
  });

  it.each(["added", "replaced", "content_changed"] as const)(
    "rolls back confirmation when active speaker terms are %s after preflight",
    async (change) => {
      const f = await fixture(`terms-${change}@speaker-employer.example`, "pending");
      await claimedOrganization();
      const p = await proof(f);
      const selected = await patch(f, { continuationToken: p.token, unaffiliatedAttestation: false });
      expect(selected.status, await selected.clone().text()).toBe(200);
      const before = await speakerState(f.speakerId);
      const sourceRevision = await getEventParticipantSourceRevision(env.DB, f.eventId, f.userId);
      const rosterRevision = await getProposalSpeakerRosterRevision(env.DB, f.proposalId);
      const auditBefore = await env.DB.prepare("SELECT id,action FROM audit_log WHERE entity_id=? ORDER BY id")
        .bind(f.speakerId)
        .all();
      const racingDb = mutateBeforeNextBatch(env.DB, async () => {
        if (change === "added") {
          await env.DB.prepare(
            `INSERT INTO event_terms
             (id,event_id,audience_type,term_key,version,required,content_ref,active,created_at)
             VALUES (?,?,'speaker','additional-speaker-terms','v1',1,'/additional-speaker-terms',1,?)`,
          )
            .bind(crypto.randomUUID(), f.eventId, new Date().toISOString())
            .run();
        } else {
          await env.DB.prepare(
            change === "replaced"
              ? "UPDATE event_terms SET version='v2' WHERE event_id=? AND audience_type='speaker' AND active=1"
              : "UPDATE event_terms SET content_ref='/updated-speaker-terms' WHERE event_id=? AND audience_type='speaker' AND active=1",
          )
            .bind(f.eventId)
            .run();
        }
      });
      await expect(
        confirmSpeakerParticipation(racingDb, f.token, env.INTERNAL_SIGNING_SECRET!, {
          consents: [{ termKey: "speaker-terms", version: "v1" }],
          ip: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
      expect(await speakerState(f.speakerId)).toEqual(before);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM consent_acceptances WHERE proposal_id=? AND user_id=?")
          .bind(f.proposalId, f.userId)
          .first("count"),
      ).toBe(0);
      expect(
        (await env.DB.prepare("SELECT id,action FROM audit_log WHERE entity_id=? ORDER BY id").bind(f.speakerId).all())
          .results,
      ).toEqual(auditBefore.results);
      expect(await getEventParticipantSourceRevision(env.DB, f.eventId, f.userId)).toBe(sourceRevision);
      expect(await getProposalSpeakerRosterRevision(env.DB, f.proposalId)).toBe(rosterRevision);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM registrations WHERE event_id=? AND user_id=?")
          .bind(f.eventId, f.userId)
          .first("count"),
      ).toBe(0);
    },
  );
});
