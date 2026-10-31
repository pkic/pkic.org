import { proposalIdentityFixture as fixture, submitIdentityProposal as submit } from "./helpers/proposal-identity";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callApi } from "./helpers/app";
import { prepareProposalProof } from "./helpers/proposal-proof";
import { createMemberSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { speakerSelfServiceReadResponseSchema } from "../assets/shared/schemas/speaker-self-service";
import {
  proposalCreateResponseSchema,
  proposalSpeakerPatchSchema,
  coSpeakerInviteSchema,
  speakerSelfProfilePatchSchema,
} from "../assets/shared/schemas/proposal-management";
import { identitiesListResponseSchema } from "../assets/shared/schemas/identity";
import { nowIso } from "../functions/_lib/utils/time";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { getSpeakerByManageToken } from "../functions/_lib/services/proposals";
import { updateSpeakerProfile } from "../functions/_lib/services/proposals-speaker-profile";
import { confirmSpeakerParticipation } from "../functions/_lib/services/proposal-speaker-confirmation";
import { prepareProposalActingIdentity } from "../functions/_lib/services/proposal-speaker-identity";
import {
  eventProposalProofIdentityPatchResponseSchema,
  eventProposalProofIdentityPatchSchema,
} from "../assets/shared/schemas/event-proposal-proof";

beforeEach(resetDb);

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
  it("corrects a recorded organization representation without changing the proposal, speaker role or capacities", async () => {
    const f = await fixture();
    const submitted = await submit(f.body, f.token);
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    const { proposalId } = proposalCreateResponseSchema.parse(await submitted.json());
    const path = await speakerPath(proposalId, f.userId);
    const read = async () => speakerSelfServiceReadResponseSchema.parse(await (await callApi(env, path)).json());
    const original = await read();
    expect(original.profile).toMatchObject({
      actingIdentityId: f.identityId,
      organizationName: "Chosen organization",
      jobTitle: "Chosen role",
    });
    const speaker = () =>
      queryAll(
        env.DB,
        "SELECT id,proposal_id,user_id,role,status,confirmed_at FROM proposal_speakers WHERE proposal_id=?",
        [proposalId],
      );
    const originalSpeaker = await speaker();
    expect(originalSpeaker).toEqual([expect.objectContaining({ user_id: f.userId, role: "proposer" })]);
    const unchanged = () =>
      Promise.all([
        queryAll(env.DB, "SELECT id,email,first_name,last_name FROM users ORDER BY id"),
        queryAll(env.DB, "SELECT id,name,normalized_name,updated_at FROM organizations ORDER BY id"),
        queryAll(
          env.DB,
          "SELECT id,user_id,organization_id,email_id,job_title,biography,links_json,started_at,ended_at,blocked_at,updated_at FROM identities ORDER BY id",
        ),
        queryAll(
          env.DB,
          `SELECT (SELECT COUNT(*) FROM members) AS members,
        (SELECT COUNT(*) FROM member_category_assignments) AS categories,
        (SELECT COUNT(*) FROM identity_member_capacities) AS capacities,
        (SELECT COUNT(*) FROM user_roles) AS roles,(SELECT COUNT(*) FROM permission_grants) AS grants,
        (SELECT COUNT(*) FROM session_proposals) AS proposals`,
        ),
      ]);
    const before = await unchanged();
    const correction = await callApi(env, `${path}/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${f.token}` },
      body: JSON.stringify(speakerSelfProfilePatchSchema.parse({ actingIdentityId: f.secondIdentityId })),
    });
    expect(correction.status, await correction.clone().text()).toBe(200);
    const corrected = await read();
    expect(corrected.profile).toMatchObject({
      actingIdentityId: f.secondIdentityId,
      actingIdentitySelection: "identity",
      organizationName: "Other organization",
      jobTitle: "Second role",
    });
    expect(corrected.profile.actingIdentitySelectedAt).toBeTruthy();
    expect(await speaker()).toEqual(originalSpeaker);
    expect(await unchanged()).toEqual(before);
    const recorded = await queryAll<{ acting_identity_id: string }>(
      env.DB,
      "SELECT acting_identity_id FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
      [proposalId, f.userId],
    );
    expect(recorded).toEqual([{ acting_identity_id: f.secondIdentityId }]);
  });

  it("shows the deliberately chosen identity's live organization and title without editing the account", async () => {
    const f = await fixture();
    const response = await submit(
      { ...f.body, proposer: { ...f.body.proposer, actingIdentityId: f.secondIdentityId } },
      f.token,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const { proposalId } = (await response.json()) as { proposalId: string };
    await env.DB.prepare("UPDATE identities SET job_title='Later role' WHERE id=?").bind(f.secondIdentityId).run();
    const read = speakerSelfServiceReadResponseSchema.parse(
      await (await callApi(env, await speakerPath(proposalId, f.userId))).json(),
    );
    expect(read.profile).toMatchObject({
      actingIdentityId: f.secondIdentityId,
      actingIdentitySelection: "identity",
      organizationName: "Other organization",
      jobTitle: "Later role",
    });
    expect(read.profile.actingIdentitySelectedAt).toBeTruthy();
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", [f.userId])).toEqual([
      { first_name: "Identity", last_name: "Speaker" },
    ]);
  });

  async function submitWithCoSpeaker(f: Awaited<ReturnType<typeof fixture>>, coEmail: string) {
    const response = await submit(
      {
        ...f.body,
        speakers: [
          {
            email: coEmail,
            firstName: "Co",
            lastName: "Speaker",
            role: "speaker",
          },
        ],
      },
      f.token,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return proposalCreateResponseSchema.parse(await response.json()).proposalId;
  }
  async function coSpeakerRow(proposalId: string, userId: string) {
    return env.DB.prepare(
      "SELECT status,acting_identity_id,acting_identity_selected_at FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
    )
      .bind(proposalId, userId)
      .first<{
        status: string;
        acting_identity_id: string | null;
        acting_identity_selected_at: string | null;
      }>();
  }

  it("attaches an added speaker to the representation held through the invited address, still to be confirmed", async () => {
    const f = await fixture();
    const coEmail = `co-speaker-${crypto.randomUUID()}@example.test`;
    const coUserId = await insertUser(env.DB, coEmail);
    await env.DB.prepare("UPDATE users SET first_name='Co',last_name='Speaker' WHERE id=?").bind(coUserId).run();
    const coOrganization = await insertOrganization(env.DB, "Affiliated organization");
    const coMember = await seedOrganizationAggregate(env.DB, coOrganization, "A");
    const coIdentityId = await addRepresentative(env.DB, coMember, coUserId, { jobTitle: "Affiliated role" });
    const identitiesBefore = await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [coUserId]);
    const proposalId = await submitWithCoSpeaker(f, coEmail);
    // The same recorded representation the proposer has; the speaker still confirms their participation.
    const row = await coSpeakerRow(proposalId, coUserId);
    expect(row).toMatchObject({ status: "invited", acting_identity_id: coIdentityId });
    expect(row?.acting_identity_selected_at).toBeTruthy();
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [coUserId])).toEqual(identitiesBefore);
    const read = speakerSelfServiceReadResponseSchema.parse(
      await (await callApi(env, await speakerPath(proposalId, coUserId))).json(),
    );
    expect(read.profile).toMatchObject({
      actingIdentityId: coIdentityId,
      actingIdentitySelection: "identity",
      organizationName: "Affiliated organization",
      jobTitle: "Affiliated role",
    });
    // The proposer acts as a selected identity, which wins over their affiliation.
    const proposer = speakerSelfServiceReadResponseSchema.parse(
      await (await callApi(env, await speakerPath(proposalId, f.userId))).json(),
    );
    expect(proposer.profile).toMatchObject({ organizationName: "Chosen organization", jobTitle: "Chosen role" });
  });

  it("links an added speaker through their address's organization domain, as a proposer's address is", async () => {
    const f = await fixture();
    const domain = `linked-${crypto.randomUUID().slice(0, 8)}.example.test`;
    const coUserId = await insertUser(env.DB, `co-speaker@${domain}`);
    const coOrganization = await insertOrganization(env.DB, "Domain organization");
    const coMember = await seedOrganizationAggregate(env.DB, coOrganization, "A");
    await env.DB.prepare(
      "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES(?,?,?,datetime('now'),datetime('now'))",
    )
      .bind(crypto.randomUUID(), domain, coOrganization)
      .run();
    const coIdentityId = await addRepresentative(env.DB, coMember, coUserId, { jobTitle: "Domain role" });
    // The identity is held through another of their addresses; the invited one links by its domain.
    const alias = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO user_emails (id,user_id,email,normalized_email,verified_at,created_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))",
    )
      .bind(alias, coUserId, `speaker.alias@${domain}`, `speaker.alias@${domain}`)
      .run();
    await env.DB.prepare("UPDATE identities SET email_id=? WHERE id=?").bind(alias, coIdentityId).run();
    const proposalId = await submitWithCoSpeaker(f, `co-speaker@${domain}`);
    expect(await coSpeakerRow(proposalId, coUserId)).toMatchObject({
      status: "invited",
      acting_identity_id: coIdentityId,
    });
  });

  it("leaves an added speaker unrecorded when no titled representation links to the address, for them to choose", async () => {
    const f = await fixture();
    const coEmail = `co-speaker-${crypto.randomUUID()}@example.test`;
    const coUserId = await insertUser(env.DB, coEmail);
    const coOrganization = await insertOrganization(env.DB, "Affiliated organization");
    const coMember = await seedOrganizationAggregate(env.DB, coOrganization, "A");
    await addRepresentative(env.DB, coMember, coUserId, { jobTitle: null });
    const newcomer = `newcomer-${crypto.randomUUID()}@example.test`;
    const proposalId = await submitWithCoSpeaker(f, coEmail);
    expect(await coSpeakerRow(proposalId, coUserId)).toMatchObject({
      status: "invited",
      acting_identity_id: null,
      acting_identity_selected_at: null,
    });
    const read = speakerSelfServiceReadResponseSchema.parse(
      await (await callApi(env, await speakerPath(proposalId, coUserId))).json(),
    );
    expect(read.profile).toMatchObject({
      actingIdentitySelection: "unrecorded",
      organizationName: "Affiliated organization",
    });
    // The proposer's acceptance of the terms is never recorded for the speaker they added.
    expect(
      await queryAll(env.DB, "SELECT DISTINCT user_id FROM consent_acceptances WHERE proposal_id=?", [proposalId]),
    ).toEqual([{ user_id: f.userId }]);
    // The added speaker is told at once, through the outbox: who proposed them, the session, and where to respond.
    const invitation = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE template_key='co_speaker_invite' AND recipient_user_id=?",
    )
      .bind(coUserId)
      .first<{ payload_json: string }>();
    const data = await deliveredEmailPayload<Record<string, unknown>>(env.DB, env, invitation!.payload_json);
    expect(data.invitedByDisplay).toBeTruthy();
    expect(JSON.stringify(data.proposalTitle)).toContain(f.body.proposal.title);
    expect(data.proposalAbstract).toBeTruthy();
    expect(String(data.manageUrl)).toContain("/propose/speaker/");
    // A new person starts with their personal account identity; an organization identity waits for their own mailbox proof.
    const second = await submitWithCoSpeaker(f, newcomer);
    const created = await env.DB.prepare("SELECT id FROM users WHERE normalized_email=?")
      .bind(newcomer)
      .first<{ id: string }>();
    expect(await coSpeakerRow(second, created!.id)).toMatchObject({ acting_identity_id: null });
    expect(
      await queryAll(env.DB, "SELECT organization_id,source FROM identities WHERE user_id=?", [created!.id]),
    ).toEqual([{ organization_id: null, source: "account" }]);
  });

  it("refuses organization and title overrides through the speaker profile contracts", () => {
    expect(proposalSpeakerPatchSchema.safeParse({ organizationName: "Override employer" }).success).toBe(false);
    expect(proposalSpeakerPatchSchema.safeParse({ jobTitle: "Override role" }).success).toBe(false);
    expect(speakerSelfProfilePatchSchema.safeParse({ organizationName: "Override employer" }).success).toBe(false);
    expect(speakerSelfProfilePatchSchema.safeParse({ jobTitle: "Override role" }).success).toBe(false);
    // The identity step may name the affiliation a confirmed email creates.
    expect(
      speakerSelfProfilePatchSchema.safeParse({ continuationToken: "a".repeat(64), jobTitle: "New role" }).success,
    ).toBe(true);
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
    expect(proposalSpeakerPatchSchema.safeParse({ actingIdentityId: identity }).success).toBe(false);
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
    // Taking part as an individual speaks as the person's individual identity, created when they held none.
    expect(
      catalog.identities
        .filter((identity) => identity.organizationId !== null)
        .map((identity) => identity.id)
        .sort(),
    ).toEqual([f.identityId, f.secondIdentityId].sort());
    expect(catalog.identities.filter((identity) => identity.organizationId === null)).toHaveLength(1);
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

  it("edits the identity the speaker speaks as through their speaker link, never a copy on the proposal", async () => {
    const f = await fixture();
    const response = await submit(f.body, f.token);
    const { proposalId } = (await response.json()) as { proposalId: string };
    const before = await queryAll(
      env.DB,
      "SELECT acting_identity_id,acting_identity_selected_at FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
      [proposalId, f.userId],
    );
    const path = await speakerPath(proposalId, f.userId);
    const override = await callApi(env, `${path}/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationName: "Submitted appearance affiliation", jobTitle: "Submitted role" }),
    });
    expect(override.status).toBe(400);
    // The speaker link authorizes an edit of the speaker's own identity, through the shared identity contract.
    const speakerManagementToken = decodeURIComponent(path.split("/").pop()!);
    const edit = await callApi(env, `/api/v1/events/pqc-2026/proposals/proof/identities/${f.identityId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        eventProposalProofIdentityPatchSchema.parse({
          biography: "Updated identity biography",
          links: ["https://example.test/speaker"],
          speakerManagementToken,
        }),
      ),
    });
    expect(edit.status, await edit.clone().text()).toBe(200);
    expect(eventProposalProofIdentityPatchResponseSchema.parse(await edit.json())).toMatchObject({
      identityId: f.identityId,
      biography: "Updated identity biography",
      links: ["https://example.test/speaker"],
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT acting_identity_id,acting_identity_selected_at FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
        [proposalId, f.userId],
      ),
    ).toEqual(before);
    expect(await queryAll(env.DB, "SELECT biography,links_json FROM identities WHERE id=?", [f.identityId])).toEqual([
      { biography: "Updated identity biography", links_json: '["https://example.test/speaker"]' },
    ]);
    expect(speakerSelfServiceReadResponseSchema.parse(await (await callApi(env, path)).json()).profile).toMatchObject({
      actingIdentityId: f.identityId,
      organizationName: "Chosen organization",
      jobTitle: "Chosen role",
      biography: "Updated identity biography",
      links: ["https://example.test/speaker"],
    });
    // Another person's identity is never reachable through this speaker's link.
    const stranger = await insertUser(env.DB, "identity-stranger@example.test");
    const strangerOrganization = await insertOrganization(env.DB, "Stranger identity organization");
    const strangerMember = await seedOrganizationAggregate(env.DB, strangerOrganization, "A");
    const strangerIdentity = await addRepresentative(env.DB, strangerMember, stranger, { jobTitle: "Their role" });
    const foreign = await callApi(env, `/api/v1/events/pqc-2026/proposals/proof/identities/${strangerIdentity}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ biography: "Hijacked biography", speakerManagementToken }),
    });
    expect(foreign.status).toBe(404);
    expect(await queryAll(env.DB, "SELECT biography FROM identities WHERE id=?", [strangerIdentity])).toEqual([
      { biography: null },
    ]);
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
    // Without a live session, the link alone does not rename an account whose mailbox was proved.
    const rename = await callApi(env, `${path}/profile`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ firstName: "Identity" }),
    });
    expect(rename.status).toBe(403);
    expect(await rename.json()).toMatchObject({ error: { code: "SPEAKER_ACCOUNT_SIGN_IN_REQUIRED" } });
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
      const { speaker, proposal } = await getSpeakerByManageToken(env.DB, capability, env.INTERNAL_SIGNING_SECRET!);
      const sessionId = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=? AND revoked_at IS NULL")
        .bind(f.userId)
        .first<string>("id");
      const before = await queryAll(
        env.DB,
        "SELECT acting_identity_id,acting_identity_selected_at FROM proposal_speakers WHERE id=?",
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
            expectedActingIdentityId: speaker.acting_identity_id,
            expectedActingIdentitySelectedAt: speaker.acting_identity_selected_at,
            authority: capability,
            expectedManageLinkSecret: speaker.manage_link_secret,
            selectionAuthority: { userId: f.userId, sessionId: sessionId! },
          },
        ),
      ).rejects.toMatchObject({ code: "PROPOSAL_SPEAKER_CONFLICT" });
      expect(
        await queryAll(
          env.DB,
          "SELECT acting_identity_id,acting_identity_selected_at FROM proposal_speakers WHERE id=?",
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
    });
    await env.DB.prepare("UPDATE identities SET ended_at='2024-01-01T00:00:00.000Z' WHERE id=?")
      .bind(f.identityId)
      .run();
    await expect(env.DB.batch(prepared.guards)).resolves.toHaveLength(1);
    expect(prepared.representation).toMatchObject({ organizationName: "Chosen organization", jobTitle: "Chosen role" });
    const stillValid = await prepareProposalActingIdentity(env.DB, {
      userId: f.userId,
      actingIdentityId: f.identityId,
      at: prepared.selectedAt,
    });
    expect(stillValid.representation).toEqual(prepared.representation);
    await expect(
      prepareProposalActingIdentity(env.DB, {
        userId: f.userId,
        actingIdentityId: f.identityId,
        at: "2024-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_IDENTITY_UNAVAILABLE" });
  });
});
