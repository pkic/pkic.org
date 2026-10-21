import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createAdminSession } from "./helpers/auth";
import { administratorGrants } from "./helpers/administrator";
import { selectIndividualSpeakerRepresentation } from "./helpers/proposal-proof";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { persistConsents } from "../functions/_lib/services/consent";
import { acceptSpeakerParticipationByManager } from "../functions/_lib/services/proposal-speaker-confirmation";
import { addProposalSpeaker, createProposal } from "../functions/_lib/services/proposals";
import { findOrCreateUser } from "../functions/_lib/services/users";
import {
  requestProposalSpeakerCapacity,
  raceBeforeFirstBatch,
  inviteSpeakerAndSubmitCapacityProposal,
  setupProposalSpeakerCapacityWorkflow,
} from "./helpers/proposal-speaker-capacity";

describe("organizer speaker acceptance", () => {
  let adminSessionToken: string;
  let eventId: string;
  let adminUserId: string;
  beforeEach(async () => {
    await resetDb();
    ({ adminSessionToken, eventId, adminUserId } = await setupProposalSpeakerCapacityWorkflow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  });
  afterEach(() => vi.unstubAllGlobals());
  async function acceptanceFixture() {
    const speaker = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await selectIndividualSpeakerRepresentation({
      environment: env,
      eventSlug: "pqc-2026",
      email: "cospeaker@example.test",
      consents: [{ termKey: "speaker-terms", version: "v1" }],
      speakerManagementToken: speaker.speakerManageToken,
    });
    return speaker;
  }
  function acceptRequest(proposalId: string, userId: string, token: string | null = adminSessionToken, body = {}) {
    return requestProposalSpeakerCapacity(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${userId}/acceptance`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  }
  async function recordSpeakerConsent(proposalId: string, userId: string) {
    await persistConsents(env.DB, {
      eventId,
      proposalId,
      userId,
      audienceType: "speaker",
      accepted: [{ termKey: "speaker-terms", version: "v1" }],
      ip: null,
      userAgent: null,
      secret: env.INTERNAL_SIGNING_SECRET!,
    });
  }

  it("accepts for a speaker with existing identity and terms without creating personal consent", async () => {
    const { proposalId, coSpeakerUserId } = await acceptanceFixture();
    await recordSpeakerConsent(proposalId, coSpeakerUserId);
    const before = await queryAll(env.DB, "SELECT id, accepted_at FROM consent_acceptances WHERE proposal_id=?", [
      proposalId,
    ]);
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT status, terms_accepted_at FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
        [proposalId, coSpeakerUserId],
      ),
    ).toEqual([{ status: "confirmed", terms_accepted_at: expect.any(String) }]);
    expect(
      await queryAll(env.DB, "SELECT id, accepted_at FROM consent_acceptances WHERE proposal_id=?", [proposalId]),
    ).toEqual(before);
    expect(
      await queryAll(env.DB, "SELECT actor_id FROM audit_log WHERE action='speaker_confirmed_by_organizer'"),
    ).toEqual([{ actor_id: adminUserId }]);
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT actor_id FROM audit_log WHERE action='speaker_confirmed_by_organizer'"),
    ).toHaveLength(1);
  });

  it("reuses event speaker consent originally accepted on another proposal", async () => {
    const original = await acceptanceFixture();
    await recordSpeakerConsent(original.proposalId, original.coSpeakerUserId);
    const { proposal } = await createProposal(env.DB, {
      eventId,
      proposerUserId: adminUserId,
      proposalType: "talk",
      title: "Another talk at the same event",
      abstract: "A second proposal sharing the same speaker and event terms.",
    });
    const { manageToken } = await addProposalSpeaker(env.DB, {
      proposalId: proposal.id,
      userId: original.coSpeakerUserId,
      role: "co_speaker",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    await selectIndividualSpeakerRepresentation({
      environment: env,
      eventSlug: "pqc-2026",
      email: "cospeaker@example.test",
      consents: [{ termKey: "speaker-terms", version: "v1" }],
      speakerManagementToken: manageToken,
    });
    const later = { proposalId: proposal.id, coSpeakerUserId: original.coSpeakerUserId };
    expect(later.proposalId).not.toBe(original.proposalId);
    expect(later.coSpeakerUserId).toBe(original.coSpeakerUserId);
    await recordSpeakerConsent(later.proposalId, later.coSpeakerUserId);
    const before = await queryAll(
      env.DB,
      "SELECT id, proposal_id, accepted_at FROM consent_acceptances WHERE user_id=? AND audience_type='speaker'",
      [later.coSpeakerUserId],
    );
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ proposal_id: original.proposalId });
    expect((await acceptRequest(later.proposalId, later.coSpeakerUserId)).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id=? AND user_id=?", [
        later.proposalId,
        later.coSpeakerUserId,
      ]),
    ).toEqual([{ status: "confirmed" }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id, proposal_id, accepted_at FROM consent_acceptances WHERE user_id=? AND audience_type='speaker'",
        [later.coSpeakerUserId],
      ),
    ).toEqual(before);
  });

  it("confirms an unselected speaker identity and terms without claiming mailbox verification or personal consent", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await env.DB.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").bind(coSpeakerUserId).run();
    await env.DB.prepare(
      "UPDATE event_terms SET display_text='Speaker conditions', help_text='Recording and publication permitted', content_ref='/speaker-terms/' WHERE event_id=? AND audience_type='speaker'",
    )
      .bind(eventId)
      .run();
    expect((await acceptRequest(proposalId, coSpeakerUserId, null)).status).toBe(401);
    expect((await acceptRequest(proposalId, coSpeakerUserId, adminSessionToken, { consents: [] })).status).toBe(400);
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT status, acting_identity_id, acting_identity_selected_at, terms_accepted_at FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
        [proposalId, coSpeakerUserId],
      ),
    ).toEqual([
      {
        status: "confirmed",
        acting_identity_id: null,
        acting_identity_selected_at: expect.any(String),
        terms_accepted_at: expect.any(String),
      },
    ]);
    expect(await queryAll(env.DB, "SELECT email_verified_at FROM users WHERE id=?", [coSpeakerUserId])).toEqual([
      { email_verified_at: null },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM consent_acceptances WHERE user_id=?", [coSpeakerUserId])).toEqual([]);
    const audit = await queryAll<{ actor_id: string; details_json: string }>(
      env.DB,
      "SELECT actor_id, details_json FROM audit_log WHERE action='speaker_confirmed_by_organizer'",
    );
    expect(audit[0].actor_id).toBe(adminUserId);
    expect(JSON.parse(audit[0].details_json)).toMatchObject({
      acceptanceSource: { to: "organizer" },
      terms: { to: [{ term_key: "speaker-terms", version: "v1", display_text: "Speaker conditions" }] },
    });
    const emails = await queryAll<{ recipient_email: string; payload_json: string }>(
      env.DB,
      "SELECT recipient_email, payload_json FROM email_outbox WHERE recipient_user_id=? AND template_key='proposal_speaker_confirmed_by_organizer'",
      [coSpeakerUserId],
    );
    expect(emails).toHaveLength(1);
    expect(emails[0].recipient_email).toBe("cospeaker@example.test");
    const payload = JSON.parse(emails[0].payload_json);
    expect(payload).not.toHaveProperty("__directBodyContent");
    const deliveries = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body ?? "{}")));
    const notification = deliveries.find((message) => message.subject?.startsWith("Configured speaker notice"));
    expect(notification).toBeDefined();
    const rendered = notification.content.map((part: { value: string }) => part.value).join("\n");
    expect(rendered).toContain("Configured speaker notice:");
    expect(rendered).toContain("Speaker conditions");
    expect(rendered).toContain("Recording and publication permitted");
    expect(rendered).toContain("v1");
    expect(rendered).toContain("contact@pkic.org");
    expect(payload.__replyTo).toBe("contact@pkic.org");
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM email_outbox WHERE recipient_user_id=? AND template_key='proposal_speaker_confirmed_by_organizer'",
        [coSpeakerUserId],
      ),
    ).toHaveLength(1);
  });

  it.each([
    { reference: null, resolved: "" },
    { reference: "", resolved: "" },
    { reference: "https://[invalid", resolved: "" },
    { reference: "/speaker-terms/", resolved: "https://app.test/speaker-terms/" },
    { reference: "https://example.test/terms", resolved: "https://example.test/terms" },
  ])("confirms participation with term content reference $reference", async ({ reference, resolved }) => {
    const { proposalId, coSpeakerUserId } = await acceptanceFixture();
    await env.DB.prepare("UPDATE event_terms SET content_ref=? WHERE event_id=? AND audience_type='speaker'")
      .bind(reference, eventId)
      .run();
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id=? AND user_id=?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).toEqual([{ status: "confirmed" }]);
    const notification = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => JSON.parse(String(init?.body ?? "{}")))
      .find((message) => message.subject?.startsWith("Configured speaker notice"));
    expect(notification).toBeDefined();
    const text = notification.content.find((part: { type: string }) => part.type === "text/plain").value;
    expect(text).toContain("speaker-terms");
    if (resolved) expect(text).toContain(resolved);
    else if (reference) expect(text).not.toContain(reference);
  });

  it.each([false, true])(
    "confirms the displayed organization identity and its address (selection recorded: %s)",
    async (selected) => {
      const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
      const organizationId = await insertOrganization(env.DB, "Speaker Organization");
      const memberId = await seedOrganizationAggregate(env.DB, organizationId);
      const identityId = await addRepresentative(env.DB, memberId, coSpeakerUserId, { jobTitle: "Engineer" });
      const emailId = crypto.randomUUID();
      const at = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO user_emails (id,user_id,email,normalized_email,verified_at,created_at) VALUES (?,?,?,?,?,?)",
      )
        .bind(emailId, coSpeakerUserId, "speaker@organization.test", "speaker@organization.test", at, at)
        .run();
      await env.DB.prepare("UPDATE identities SET email_id=?, is_default=1 WHERE id=?").bind(emailId, identityId).run();
      if (selected) {
        await env.DB.prepare(
          "UPDATE proposal_speakers SET acting_identity_id=?, acting_identity_selected_at=? WHERE proposal_id=? AND user_id=?",
        )
          .bind(identityId, at, proposalId, coSpeakerUserId)
          .run();
        const otherOrganizationId = await insertOrganization(env.DB, "Different Default Organization");
        const otherMemberId = await seedOrganizationAggregate(env.DB, otherOrganizationId);
        const otherIdentityId = await addRepresentative(env.DB, otherMemberId, coSpeakerUserId, {
          jobTitle: "Director",
        });
        await env.DB.prepare("UPDATE identities SET is_default=0 WHERE id=?").bind(identityId).run();
        await env.DB.prepare("UPDATE identities SET is_default=1 WHERE id=?").bind(otherIdentityId).run();
      }
      expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(200);
      expect(
        await queryAll(
          env.DB,
          "SELECT acting_identity_id, status FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
          [proposalId, coSpeakerUserId],
        ),
      ).toEqual([{ acting_identity_id: identityId, status: "confirmed" }]);
      expect(
        await queryAll(
          env.DB,
          "SELECT recipient_email FROM email_outbox WHERE recipient_user_id=? AND template_key='proposal_speaker_confirmed_by_organizer'",
          [coSpeakerUserId],
        ),
      ).toEqual([{ recipient_email: "speaker@organization.test" }]);
    },
  );

  it("rolls back identity confirmation, audit, and notification when the displayed identity changes", async () => {
    const { proposalId, coSpeakerUserId } = await acceptanceFixture();
    const db = raceBeforeFirstBatch(async () => {
      await env.DB.prepare("UPDATE identities SET ended_at=? WHERE user_id=?")
        .bind(new Date().toISOString(), coSpeakerUserId)
        .run();
    });
    await expect(
      acceptSpeakerParticipationByManager(
        db,
        { identityType: "user", id: adminUserId, email: "admin@pkic.org", grants: administratorGrants },
        proposalId,
        coSpeakerUserId,
        "https://app.test",
      ),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    expect(
      await queryAll(
        env.DB,
        "SELECT status, terms_accepted_at FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
        [proposalId, coSpeakerUserId],
      ),
    ).toEqual([{ status: "invited", terms_accepted_at: null }]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='speaker_confirmed_by_organizer'")).toEqual(
      [],
    );
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM email_outbox WHERE recipient_user_id=? AND template_key='proposal_speaker_confirmed_by_organizer'",
        [coSpeakerUserId],
      ),
    ).toEqual([]);
  });

  it("authorizes event-scoped management but refuses reviewers and declined or closed participation", async () => {
    const { proposalId, coSpeakerUserId } = await acceptanceFixture();
    await recordSpeakerConsent(proposalId, coSpeakerUserId);
    const reviewer = await findOrCreateUser(env.DB, {
      email: "acceptance-reviewer@example.test",
      firstName: "Review",
      lastName: "Only",
    });
    await env.DB.prepare(`INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,created_at)
      VALUES (?,?,'proposals:score','event',?,?)`)
      .bind(crypto.randomUUID(), reviewer.id, eventId, new Date().toISOString())
      .run();
    const reviewerToken = await createAdminSession(env.DB, reviewer.id, "acceptance-reviewer");
    expect((await acceptRequest(proposalId, coSpeakerUserId, reviewerToken)).status).toBe(403);
    await env.DB.prepare("UPDATE permission_grants SET permission='proposals:manage' WHERE user_id=?")
      .bind(reviewer.id)
      .run();
    expect((await acceptRequest(proposalId, coSpeakerUserId, reviewerToken)).status).toBe(200);
    await env.DB.prepare("UPDATE proposal_speakers SET status='declined' WHERE proposal_id=? AND user_id=?")
      .bind(proposalId, coSpeakerUserId)
      .run();
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(409);
    await env.DB.prepare("UPDATE proposal_speakers SET status='invited' WHERE proposal_id=? AND user_id=?")
      .bind(proposalId, coSpeakerUserId)
      .run();
    await env.DB.prepare("UPDATE session_proposals SET status='withdrawn' WHERE id=?").bind(proposalId).run();
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(409);
  });

  it("rolls back organizer acceptance and its notification if event terms change before the batch", async () => {
    const { proposalId, coSpeakerUserId } = await acceptanceFixture();
    await recordSpeakerConsent(proposalId, coSpeakerUserId);
    const db = raceBeforeFirstBatch(async () => {
      await env.DB.prepare("UPDATE event_terms SET version='v2' WHERE event_id=? AND audience_type='speaker'")
        .bind(eventId)
        .run();
    });
    await expect(
      acceptSpeakerParticipationByManager(
        db,
        { identityType: "user", id: adminUserId, email: "admin@pkic.org", grants: administratorGrants },
        proposalId,
        coSpeakerUserId,
        "https://app.test",
      ),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    expect(
      await queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id=? AND user_id=?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).toEqual([{ status: "invited" }]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='speaker_confirmed_by_organizer'")).toEqual(
      [],
    );
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM email_outbox WHERE recipient_user_id=? AND template_key='proposal_speaker_confirmed_by_organizer'",
        [coSpeakerUserId],
      ),
    ).toEqual([]);
  });
});
