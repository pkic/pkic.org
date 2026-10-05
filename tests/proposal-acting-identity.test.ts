import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callApi } from "./helpers/app";
import { prepareProposalProof } from "./helpers/proposal-proof";
import { createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { speakerSelfServiceReadResponseSchema } from "../assets/shared/schemas/speaker-self-service";
import {
  proposalCreateSchema,
  proposerSpeakerPatchSchema,
  coSpeakerInviteSchema,
} from "../assets/shared/schemas/proposal-management";
import { identitiesListResponseSchema } from "../assets/shared/schemas/identity";
import { nowIso } from "../functions/_lib/utils/time";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { getSpeakerByManageToken } from "../functions/_lib/services/proposals";
import {
  confirmSpeakerParticipation,
  updateSpeakerProfile,
} from "../functions/_lib/services/proposals-speaker-profile";
import { prepareProposalActingIdentity } from "../functions/_lib/services/proposal-speaker-identity";

beforeEach(resetDb);

async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const email = `proposal-identity-${crypto.randomUUID()}@example.test`;
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare(
    "UPDATE users SET first_name='Identity',last_name='Speaker',organization_name='Mutable account',job_title='Account role',email_verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),email_verification_method='magic_link' WHERE id=?",
  )
    .bind(userId)
    .run();
  const organizationId = await insertOrganization(env.DB, "Chosen organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  const identityId = await addRepresentative(env.DB, memberId, userId, { jobTitle: "Chosen role" });
  const otherOrganization = await insertOrganization(env.DB, "Other organization");
  const otherMember = await seedOrganizationAggregate(env.DB, otherOrganization, "A");
  const secondIdentityId = await addRepresentative(env.DB, otherMember, userId, { jobTitle: "Second role" });
  const token = await createMemberSession(env.DB, userId, crypto.randomUUID(), undefined, identityId);
  const body = proposalCreateSchema.parse({
    sourceType: "direct",
    proposer: {
      email,
      firstName: "Identity",
      lastName: "Speaker",
      actingIdentityId: identityId,
      bio: "An experienced speaker with a detailed biography for the proposed conference session.",
    },
    proposal: {
      type: "Talk",
      title: "Deliberate speaker identity selection",
      abstract:
        "A detailed presentation about choosing a deliberate speaker representation, keeping proposal affiliation independent of later account changes, and preserving approved historical appearances.",
    },
    consents: [{ termKey: "speaker-terms", version: "v1" }],
  });
  return { eventId, userId, email, identityId, secondIdentityId, token, body };
}

function submit(body: unknown, token?: string) {
  return callApi(env, "/api/v1/events/pqc-2026/proposals", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function speakerPath(proposalId: string, userId: string) {
  const speakerId = await env.DB.prepare("SELECT id FROM proposal_speakers WHERE proposal_id=? AND user_id=?")
    .bind(proposalId, userId)
    .first<string>("id");
  const token = await issueDatabaseCapability({
    db: env.DB,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "speaker_manage",
    resourceId: speakerId!,
  });
  return `/api/v1/proposals/speakers/access/${encodeURIComponent(token)}`;
}

describe("proposal speaker acting identity", () => {
  it("records the deliberate second identity and freezes affiliation without editing the account", async () => {
    const f = await fixture();
    const response = await submit(
      { ...f.body, proposer: { ...f.body.proposer, actingIdentityId: f.secondIdentityId } },
      f.token,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const { proposalId } = (await response.json()) as { proposalId: string };
    await env.DB.prepare("UPDATE identities SET job_title='Later role' WHERE id=?").bind(f.secondIdentityId).run();
    await env.DB.prepare(
      "UPDATE users SET organization_name='Later employer',job_title='Later account role' WHERE id=?",
    )
      .bind(f.userId)
      .run();
    const read = speakerSelfServiceReadResponseSchema.parse(
      await (await callApi(env, await speakerPath(proposalId, f.userId))).json(),
    );
    expect(read.profile).toMatchObject({
      actingIdentityId: f.secondIdentityId,
      actingIdentitySelection: "identity",
      organizationName: "Other organization",
      jobTitle: "Second role",
    });
    expect(read.profile.actingIdentitySelectedAt).toBeTruthy();
    expect(await queryAll(env.DB, "SELECT organization_name,job_title FROM users WHERE id=?", [f.userId])).toEqual([
      { organization_name: "Later employer", job_title: "Later account role" },
    ]);
  });

  it("requires the real signed-in owner and refuses identity selection through roster contracts", async () => {
    const f = await fixture();
    expect((await submit(f.body)).status).toBe(403);
    const stranger = await insertUser(env.DB, "stranger@example.test");
    const organization = await insertOrganization(env.DB, "Stranger employer");
    const member = await seedOrganizationAggregate(env.DB, organization, "A");
    const identity = await addRepresentative(env.DB, member, stranger);
    expect(
      (await submit({ ...f.body, proposer: { ...f.body.proposer, actingIdentityId: identity } }, f.token)).status,
    ).toBe(403);
    expect(proposerSpeakerPatchSchema.safeParse({ actingIdentityId: identity }).success).toBe(false);
    expect(
      coSpeakerInviteSchema.safeParse({ email: "stranger@example.test", actingIdentityId: identity }).success,
    ).toBe(false);
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM session_proposals").first("total")).toBe(0);
  });

  it("distinguishes explicit individual selection and restricts the capability catalog to its owner", async () => {
    const f = await fixture();
    const response = await submit(
      { ...f.body, unaffiliatedAttestation: true, proposer: { ...f.body.proposer, actingIdentityId: null } },
      f.token,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const { proposalId } = (await response.json()) as { proposalId: string };
    const path = await speakerPath(proposalId, f.userId);
    const read = speakerSelfServiceReadResponseSchema.parse(await (await callApi(env, path)).json());
    expect(read.profile).toMatchObject({
      actingIdentityId: null,
      actingIdentitySelection: "individual",
      organizationName: null,
      jobTitle: null,
    });
    expect((await callApi(env, `${path}/identities`)).status).toBe(401);
    const catalog = identitiesListResponseSchema.parse(
      await (
        await callApi(env, `${path}/identities`, {
          headers: { authorization: `Bearer ${f.token}` },
        })
      ).json(),
    );
    expect(catalog.identities.map((identity) => identity.id).sort()).toEqual([f.identityId, f.secondIdentityId].sort());
    expect(catalog.identities.every((identity) => identity.userId === f.userId)).toBe(true);
    const changed = await callApi(env, `${path}/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${f.token}` },
      body: JSON.stringify({ actingIdentityId: f.identityId }),
    });
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(
      speakerSelfServiceReadResponseSchema.parse(await (await callApi(env, path)).json()).profile.organizationName,
    ).toBe("Chosen organization");
  });

  it("records a proved guest's own canonical identity without repeating known personal fields", async () => {
    const f = await fixture();
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: f.email,
      consents: f.body.consents,
      unaffiliatedAttestation: false,
    });
    const response = await submit({ ...f.body, ...proof, proposer: { actingIdentityId: f.secondIdentityId } });
    expect(response.status, await response.clone().text()).toBe(200);
    const { proposalId } = (await response.json()) as { proposalId: string };
    const read = speakerSelfServiceReadResponseSchema.parse(
      await (await callApi(env, await speakerPath(proposalId, f.userId))).json(),
    );
    expect(read.profile).toMatchObject({
      actingIdentityId: f.secondIdentityId,
      actingIdentitySelection: "identity",
      organizationName: "Other organization",
      jobTitle: "Second role",
      firstName: "Identity",
      lastName: "Speaker",
    });
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", [f.userId])).toEqual([
      { first_name: "Identity", last_name: "Speaker" },
    ]);
  });

  it("keeps guest edits as authored overrides without rewriting recorded canonical provenance", async () => {
    const f = await fixture();
    const response = await submit(f.body, f.token);
    const { proposalId } = (await response.json()) as { proposalId: string };
    const before = await queryAll(
      env.DB,
      "SELECT acting_identity_id,acting_identity_selected_at,acting_identity_snapshot_json FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
      [proposalId, f.userId],
    );
    const path = await speakerPath(proposalId, f.userId);
    const edit = await callApi(env, `${path}/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationName: "Submitted appearance affiliation",
        jobTitle: "Submitted appearance role",
        biography: "Updated authored biography",
      }),
    });
    expect(edit.status, await edit.clone().text()).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT acting_identity_id,acting_identity_selected_at,acting_identity_snapshot_json FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
        [proposalId, f.userId],
      ),
    ).toEqual(before);
    expect(speakerSelfServiceReadResponseSchema.parse(await (await callApi(env, path)).json()).profile).toMatchObject({
      actingIdentityId: f.identityId,
      organizationName: "Submitted appearance affiliation",
      jobTitle: "Submitted appearance role",
    });
  });

  it("refuses anonymous, wrong-owner, and revoked-session catalog or explicit selection while retaining guest edits", async () => {
    const f = await fixture();
    const response = await submit(f.body, f.token);
    const { proposalId } = (await response.json()) as { proposalId: string };
    const path = await speakerPath(proposalId, f.userId);
    const stranger = await insertUser(env.DB, "catalog-stranger@example.test");
    const organization = await insertOrganization(env.DB, "Stranger organization");
    const member = await seedOrganizationAggregate(env.DB, organization, "A");
    const foreignIdentity = await addRepresentative(env.DB, member, stranger);
    const wrongToken = await createMemberSession(env.DB, stranger, crypto.randomUUID(), undefined, foreignIdentity);
    for (const [token, status] of [
      [undefined, 401],
      [wrongToken, 403],
    ] as const) {
      const headers = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
      expect((await callApi(env, `${path}/identities`, { headers })).status).toBe(status);
      expect(
        (
          await callApi(env, `${path}/profile`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ actingIdentityId: foreignIdentity }),
          })
        ).status,
      ).toBe(status);
    }
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.userId).run();
    const headers = { "content-type": "application/json", authorization: `Bearer ${f.token}` };
    expect((await callApi(env, `${path}/identities`, { headers })).status).toBe(401);
    expect(
      (
        await callApi(env, `${path}/profile`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ actingIdentityId: f.secondIdentityId }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await callApi(env, `${path}/profile`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ biography: "Guest authored profile remains editable" }),
        })
      ).status,
    ).toBe(200);
    expect(
      speakerSelfServiceReadResponseSchema.parse(await (await callApi(env, path)).json()).profile.actingIdentityId,
    ).toBe(f.identityId);
  });

  it("rejects expired capabilities even for the matching authenticated owner", async () => {
    const f = await fixture();
    const response = await submit(f.body, f.token);
    const { proposalId } = (await response.json()) as { proposalId: string };
    const speakerId = await env.DB.prepare("SELECT id FROM proposal_speakers WHERE proposal_id=? AND user_id=?")
      .bind(proposalId, f.userId)
      .first<string>("id");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 120_000);
    let expired: string;
    try {
      expired = await issueDatabaseCapability({
        db: env.DB,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        purpose: "speaker_manage",
        resourceId: speakerId!,
        ttlSeconds: 1,
      });
    } finally {
      clock.mockRestore();
    }
    const path = `/api/v1/proposals/speakers/access/${encodeURIComponent(expired!)}`;
    const edit = await callApi(env, `${path}/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${f.token}` },
      body: JSON.stringify({ actingIdentityId: f.secondIdentityId }),
    });
    expect(edit.status).toBe(410);
    expect(
      await env.DB.prepare("SELECT acting_identity_id FROM proposal_speakers WHERE id=?")
        .bind(speakerId)
        .first("acting_identity_id"),
    ).toBe(f.identityId);
  });

  it.each(["capability", "session", "session_expiry", "invitation"] as const)(
    "rolls back selection when %s authority changes after preflight",
    async (race) => {
      const f = await fixture();
      const response = await submit(f.body, f.token);
      const { proposalId } = (await response.json()) as { proposalId: string };
      // Retain the recorded canonical selection, but exercise an invitation still awaiting participation.
      await env.DB.prepare(
        "UPDATE proposal_speakers SET status='invited',confirmed_at=NULL WHERE proposal_id=? AND user_id=?",
      )
        .bind(proposalId, f.userId)
        .run();
      const path = await speakerPath(proposalId, f.userId);
      const capability = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
      const { speaker, proposal, user } = await getSpeakerByManageToken(
        env.DB,
        capability,
        env.INTERNAL_SIGNING_SECRET!,
      );
      const sessionId = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=? AND revoked_at IS NULL")
        .bind(f.userId)
        .first<string>("id");
      const before = await queryAll(
        env.DB,
        "SELECT acting_identity_id,acting_identity_selected_at,acting_identity_snapshot_json,profile_overrides_json FROM proposal_speakers WHERE id=?",
        [speaker.id],
      );
      const audits = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM audit_log WHERE action='speaker_profile_updated_by_speaker'",
      ).first("total");
      const racedDb = mutateBeforeNextBatch(env.DB, () =>
        race === "capability"
          ? env.DB.prepare("UPDATE proposal_speakers SET manage_link_secret='revoked' WHERE id=?")
              .bind(speaker.id)
              .run()
          : race === "session"
            ? env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").bind(nowIso(), sessionId).run()
            : race === "session_expiry"
              ? env.DB.prepare("UPDATE sessions SET expires_at='2020-01-01T00:00:00.000Z' WHERE id=?")
                  .bind(sessionId)
                  .run()
              : env.DB.prepare("UPDATE events SET ends_at='2020-01-01T00:00:00.000Z' WHERE id=?")
                  .bind(proposal.event_id)
                  .run(),
      );
      await expect(
        updateSpeakerProfile(
          racedDb,
          { actingIdentityId: f.secondIdentityId, firstName: "Must roll back" },
          {
            proposalSpeakerId: speaker.id,
            proposalId,
            proposalStatus: proposal.status,
            proposalUpdatedAt: proposal.updated_at,
            userId: f.userId,
            currentStatus: speaker.status,
            inviteGeneration: speaker.invite_generation,
            expectedProfileOverridesJson: user.proposalProfileOverridesJson,
            expectedActingIdentityId: speaker.acting_identity_id,
            expectedActingIdentitySelectedAt: speaker.acting_identity_selected_at,
            expectedActingIdentitySnapshotJson: speaker.acting_identity_snapshot_json,
            authority: capability,
            expectedManageLinkSecret: speaker.manage_link_secret,
            selectionAuthority: { userId: f.userId, sessionId: sessionId! },
          },
        ),
      ).rejects.toMatchObject({ code: "PROPOSAL_SPEAKER_CONFLICT" });
      expect(
        await queryAll(
          env.DB,
          "SELECT acting_identity_id,acting_identity_selected_at,acting_identity_snapshot_json,profile_overrides_json FROM proposal_speakers WHERE id=?",
          [speaker.id],
        ),
      ).toEqual(before);
      expect(await env.DB.prepare("SELECT first_name FROM users WHERE id=?").bind(f.userId).first("first_name")).toBe(
        "Identity",
      );
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS total FROM audit_log WHERE action='speaker_profile_updated_by_speaker'",
        ).first("total"),
      ).toBe(audits);
    },
  );

  it.each(["capability", "invitation"] as const)(
    "rolls back pending canonical guest confirmation when %s scope changes",
    async (race) => {
      const f = await fixture();
      const response = await submit(f.body, f.token);
      // Keep the recorded representation while awaiting participation confirmation.
      const result = (await response.clone().json()) as { proposalId: string };
      await env.DB.prepare(
        "UPDATE proposal_speakers SET status='invited',confirmed_at=NULL WHERE proposal_id=? AND user_id=?",
      )
        .bind(result.proposalId, f.userId)
        .run();
      const { proposalId } = (await response.json()) as { proposalId: string };
      const path = await speakerPath(proposalId, f.userId);
      const capability = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
      const before = await queryAll(
        env.DB,
        "SELECT status,confirmed_at,acting_identity_selected_at FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
        [proposalId, f.userId],
      );
      const consents = await env.DB.prepare("SELECT COUNT(*) AS total FROM consent_acceptances").first("total");
      const racedDb = mutateBeforeNextBatch(env.DB, () =>
        race === "capability"
          ? env.DB.prepare(
              "UPDATE proposal_speakers SET manage_link_secret='revoked' WHERE proposal_id=? AND user_id=?",
            )
              .bind(proposalId, f.userId)
              .run()
          : env.DB.prepare("UPDATE events SET ends_at='2020-01-01T00:00:00.000Z' WHERE id=?").bind(f.eventId).run(),
      );
      await expect(
        confirmSpeakerParticipation(racedDb, capability, env.INTERNAL_SIGNING_SECRET!, {
          consents: f.body.consents,
          ip: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: "PROPOSAL_SPEAKER_CONFLICT" });
      expect(
        await queryAll(
          env.DB,
          "SELECT status,confirmed_at,acting_identity_selected_at FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
          [proposalId, f.userId],
        ),
      ).toEqual(before);
      expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM consent_acceptances").first("total")).toBe(consents);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action='speaker_confirmed'").first("total"),
      ).toBe(0);
    },
  );

  it("guards lifecycle changes atomically and enforces direct SQL ownership", async () => {
    const f = await fixture();
    const prepared = await prepareProposalActingIdentity(env.DB, {
      userId: f.userId,
      actingIdentityId: f.identityId,
      at: nowIso(),
      profile: {},
    });
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(prepared.selectedAt, f.identityId).run();
    await expect(
      env.DB.batch([
        env.DB.prepare("UPDATE users SET first_name='Must roll back' WHERE id=?").bind(f.userId),
        ...prepared.guards,
      ]),
    ).rejects.toThrow("AUTHORIZATION_CONTEXT_CHANGED");
    expect(await env.DB.prepare("SELECT first_name FROM users WHERE id=?").bind(f.userId).first("first_name")).toBe(
      "Identity",
    );
    expect((await submit(f.body, f.token)).status).toBe(403);
    const individual = await submit(
      { ...f.body, unaffiliatedAttestation: true, proposer: { ...f.body.proposer, actingIdentityId: null } },
      f.token,
    );
    expect(individual.status, await individual.clone().text()).toBe(200);
    const { proposalId } = (await individual.json()) as { proposalId: string };
    const stranger = await insertUser(env.DB, "direct-sql-stranger@example.test");
    const organization = await insertOrganization(env.DB, "Direct SQL organization");
    const member = await seedOrganizationAggregate(env.DB, organization, "A");
    const foreignIdentity = await addRepresentative(env.DB, member, stranger);
    await expect(
      env.DB.prepare("UPDATE proposal_speakers SET acting_identity_id=? WHERE proposal_id=?")
        .bind(foreignIdentity, proposalId)
        .run(),
    ).rejects.toThrow();
  });

  it("keeps a prepared historical selection valid when employment ends after its requested date", async () => {
    const f = await fixture();
    await env.DB.prepare(
      "UPDATE identities SET invited_at='2022-01-01T00:00:00.000Z',started_at='2022-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(f.identityId)
      .run();
    const prepared = await prepareProposalActingIdentity(env.DB, {
      userId: f.userId,
      actingIdentityId: f.identityId,
      at: "2023-12-01T10:00:00.000Z",
      profile: {},
    });
    await env.DB.prepare("UPDATE identities SET ended_at='2024-01-01T00:00:00.000Z' WHERE id=?")
      .bind(f.identityId)
      .run();
    await expect(env.DB.batch(prepared.guards)).resolves.toHaveLength(1);
    expect(prepared.snapshot).toMatchObject({ organizationName: "Chosen organization", jobTitle: "Chosen role" });
    const stillValid = await prepareProposalActingIdentity(env.DB, {
      userId: f.userId,
      actingIdentityId: f.identityId,
      at: prepared.selectedAt,
      profile: {},
    });
    expect(stillValid.snapshot).toEqual(prepared.snapshot);
    await expect(
      prepareProposalActingIdentity(env.DB, {
        userId: f.userId,
        actingIdentityId: f.identityId,
        at: "2024-01-01T00:00:00.000Z",
        profile: {},
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_IDENTITY_UNAVAILABLE" });
  });
});
