import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { deliveredEmailPayload, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import {
  addProposalSpeaker,
  createProposal,
  finalizeProposalDecision,
  getProposalByManageToken,
} from "../functions/_lib/services/proposals";
import app from "../functions/router";
import { renderEmail } from "../functions/_lib/email/render";

function mountedAppFetch(request: Request): Promise<Response> {
  return app.fetch(request, env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

describe("proposal participants", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("accepts event-configured session types and rejects unconfigured values", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare("UPDATE events SET settings_json = ? WHERE id = ?")
      .bind(
        JSON.stringify({
          proposal: { sessionTypes: [{ label: "Ask Me Anything", requiresPresentation: false }] },
        }),
        eventId,
      )
      .run();

    const proposalBody = (email: string, type: string) => ({
      sourceType: "direct",
      proposer: {
        firstName: "Session",
        lastName: "Speaker",
        email,
        organizationName: "Example Organization",
        jobTitle: "Engineer",
        bio: "Experienced speaker with sufficient biography text for proposal validation.",
      },
      proposal: {
        type,
        title: "Configurable Session Type Architecture",
        abstract:
          "A sufficiently detailed proposal explaining how event-configured session types flow through shared schemas and backend validation.",
      },
      consents: [{ termKey: "speaker-terms", version: "v1" }],
    });
    const request = (email: string, type: string) =>
      app.fetch(
        new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(proposalBody(email, type)),
        }),
        env as any,
        { passThroughOnException: () => {}, waitUntil: () => {} } as any,
      );

    const accepted = await request("configured-type@example.test", "ask me anything");
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as { proposalId: string };
    await expect(
      queryAll<{ proposal_type: string }>(env.DB, "SELECT proposal_type FROM session_proposals WHERE id = ?", [
        acceptedBody.proposalId,
      ]),
    ).resolves.toEqual([{ proposal_type: "Ask Me Anything" }]);

    const rejected = await request("unconfigured-type@example.test", "Workshop");
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: { code: "PROPOSAL_TYPE_NOT_ALLOWED" } });
  });

  it("delivers an existing proposer's management capability only to their canonical email", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await mountedAppFetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "direct",
          proposer: {
            firstName: "Claimed",
            lastName: "Admin",
            email: "admin@pkic.org",
            organizationName: "Untrusted Organization",
            jobTitle: "Untrusted Title",
            bio: "A sufficiently detailed biography supplied by an anonymous submitter for validation purposes.",
          },
          proposal: {
            type: "talk",
            title: "Existing identity capability delivery",
            abstract:
              "A sufficiently detailed abstract used to verify that public email equality never exposes an existing account's proposal capability.",
          },
          consents: [{ termKey: "speaker-terms", version: "v1" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const created = (await response.json()) as {
      proposalId: string;
      manageToken: string | null;
      manageUrl: string | null;
    };
    expect(created.manageToken).toBeNull();
    expect(created.manageUrl).toBeNull();

    const [queued] = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'proposal_submitted' AND recipient_email = ?",
      "admin@pkic.org",
    );
    const delivered = await deliveredEmailPayload<{ manageUrl: string }>(env.DB, env, queued.payload_json);
    const emailedToken = new URL(delivered.manageUrl).searchParams.get("token");
    expect(emailedToken).toBeTruthy();
    await expect(getProposalByManageToken(env.DB, emailedToken!, env.INTERNAL_SIGNING_SECRET!)).resolves.toMatchObject({
      id: created.proposalId,
      proposer_user_id: expect.any(String),
    });

    await expect(
      queryAll<{ first_name: string | null; organization_name: string | null }>(
        env.DB,
        "SELECT first_name, organization_name FROM users WHERE normalized_email = ?",
        "admin@pkic.org",
      ),
    ).resolves.toEqual([{ first_name: null, organization_name: null }]);
  });

  it("renders public proposal and participant fields literally while retaining trusted management links", async () => {
    await seedEventAndAdmin(env.DB);
    const attackerUrl = "https://attacker.invalid/proposal";
    const response = await mountedAppFetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "direct",
          proposer: {
            firstName: "Lead",
            lastName: "Reviewer",
            email: "literal-proposer@example.test",
            organizationName: "<script>alert(1)</script>",
            jobTitle: "Engineer",
            role: "proposer",
          },
          proposal: {
            type: "talk",
            title: `[Review](${attackerUrl})`,
            abstract:
              'A sufficiently detailed abstract with <img src="https://attacker.invalid/pixel.gif"> that must remain literal in every email.',
          },
          speakers: [
            {
              firstName: "Guest",
              lastName: "Speaker",
              email: "literal-speaker@example.test",
              organizationName: '<img src="https://attacker.invalid/org.gif">',
              role: "speaker",
              bio: "A sufficiently detailed biography for the invited speaker security regression test.",
            },
          ],
          consents: [{ termKey: "speaker-terms", version: "v1" }],
        }),
      }),
    );
    expect(response.status).toBe(200);

    const queued = await queryAll<{ template_key: string; payload_json: string }>(
      env.DB,
      "SELECT template_key, payload_json FROM email_outbox WHERE template_key IN ('proposal_submitted', 'co_speaker_invite') ORDER BY template_key",
    );
    expect(queued).toHaveLength(2);
    for (const row of queued) {
      const rendered = await renderEmail(
        "{{firstName}} {{lastName}} {{proposerFirstName}} {{invitedByDisplay}}\n\n{{proposalTitle}}\n\n{{proposalAbstract}}\n\n{{speakerLineupText}}\n\n[Manage]({{manageUrl}})",
        JSON.parse(row.payload_json) as Record<string, unknown>,
        "<!doctype html><html><body>{{{body_html}}}</body></html>",
      );
      expect(rendered.text).toContain("attacker.invalid");
      expect(rendered.html).not.toMatch(/<(?:a|img)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
      expect(rendered.html).not.toContain("<script>");
      expect(rendered.html).toMatch(/<a\b[^>]*href=["']https:\/\/app\.test\//i);
    }
  });

  it("supports panel participants and stores user links", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await mountedAppFetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "direct",
          proposer: {
            firstName: "Panel",
            lastName: "Lead",
            email: "lead@example.test",
            organizationName: "Public University",
            jobTitle: "Researcher",
            bio: "Leads cross-industry cryptography migration planning and public policy coordination programs.",
            links: ["https://example.test/lead", "https://linkedin.com/in/lead"],
            role: "moderator",
          },
          proposal: {
            type: "panel",
            title: "Panel: Real-world PQC Migration Governance",
            abstract:
              "Panel discussion on organizational governance, procurement, stakeholder management, and transition planning for post-quantum cryptography programs in regulated environments.",
          },
          speakers: [
            {
              firstName: "Panelist",
              lastName: "One",
              email: "panelist1@example.test",
              role: "panelist",
              organizationName: "National Agency",
              jobTitle: "Architect",
              bio: "Builds enterprise security reference architectures and guides cryptographic agility programs.",
              links: ["https://github.com/panelist1"],
            },
            {
              firstName: "Moderator",
              lastName: "One",
              email: "moderator@example.test",
              role: "moderator",
              organizationName: "Community Foundation",
              jobTitle: "Program Director",
              bio: "Moderates industry forums focused on interoperability and deployment readiness.",
              links: ["https://x.com/moderator"],
            },
          ],
          consents: [{ termKey: "speaker-terms", version: "v1" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { proposalId: string };

    expect(
      await queryAll<{ id: string }>(
        env.DB,
        `SELECT brj.id
           FROM badge_render_jobs brj
           JOIN referral_codes rc ON rc.code = brj.referral_code
          WHERE rc.owner_type = 'proposal' AND rc.owner_id = ?`,
        [payload.proposalId],
      ),
    ).toHaveLength(1);

    const roles = await queryAll<{ role: string }>(
      env.DB,
      "SELECT role FROM proposal_speakers WHERE proposal_id = ? ORDER BY role",
      [payload.proposalId],
    );
    expect(roles.map((entry) => entry.role)).toContain("panelist");
    expect(roles.map((entry) => entry.role)).toContain("moderator");
    expect(roles.map((entry) => entry.role)).not.toContain("proposer");

    const participantRoles = await queryAll<{ role: string }>(
      env.DB,
      `SELECT role FROM event_participant_role_sources
       WHERE event_id = (SELECT event_id FROM session_proposals WHERE id = ?)
         AND source_kind = 'proposal_speaker'
       ORDER BY role`,
      [payload.proposalId],
    );
    expect(participantRoles.map((entry) => entry.role)).toContain("panelist");
    expect(participantRoles.map((entry) => entry.role)).toContain("moderator");

    const linkRows = await queryAll<{ links_json: string | null }>(
      env.DB,
      "SELECT links_json FROM users WHERE id IN (SELECT user_id FROM proposal_speakers WHERE proposal_id = ?)",
      [payload.proposalId],
    );
    expect(linkRows.some((entry) => Boolean(entry.links_json))).toBe(true);
  });

  it("does not clear an existing proposer's bio or links when no updated profile fields are provided", async () => {
    await seedEventAndAdmin(env.DB);

    await env.DB.prepare(
      `INSERT INTO users (
        id, email, normalized_email, first_name, last_name, organization_name, job_title,
        biography, links_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        "11111111-1111-4111-8111-111111111111",
        "existing-proposer@example.test",
        "existing-proposer@example.test",
        "Existing",
        "Proposer",
        "Existing Org",
        "Existing Role",
        "Existing biography that should remain attached to the user profile.",
        JSON.stringify(["https://example.test/existing", "https://github.com/existing"]),
      )
      .run();

    const response = await mountedAppFetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "direct",
          proposer: {
            firstName: "Existing",
            lastName: "Proposer",
            email: "existing-proposer@example.test",
            organizationName: "Existing Org",
            jobTitle: "Existing Role",
            role: "proposer",
          },
          proposal: {
            type: "talk",
            title: "Operational Lessons for Certificate Migration",
            abstract:
              "A practical talk covering certificate migration lessons, stakeholder coordination, operational sequencing, and governance decisions for production security teams.",
          },
          consents: [{ termKey: "speaker-terms", version: "v1" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const row = (
      await queryAll<{ biography: string | null; links_json: string | null }>(
        env.DB,
        "SELECT biography, links_json FROM users WHERE email = ?",
        ["existing-proposer@example.test"],
      )
    )[0];
    expect(row.biography).toBe("Existing biography that should remain attached to the user profile.");
    expect(JSON.parse(row.links_json ?? "[]")).toEqual([
      "https://example.test/existing",
      "https://github.com/existing",
    ]);
  });

  it("rolls back the complete proposal submission when the final outbox insert fails", async () => {
    await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `CREATE TRIGGER reject_proposal_submission_email
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'proposal_submitted'
       BEGIN
         SELECT RAISE(ABORT, 'forced outbox failure');
       END`,
    ).run();

    try {
      const response = await mountedAppFetch(
        new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceType: "direct",
            proposer: {
              firstName: "Atomic",
              lastName: "Proposer",
              email: "atomic-proposer@example.test",
              role: "proposer",
            },
            proposal: {
              type: "talk",
              title: "Atomic Proposal Submission Test",
              abstract:
                "This valid proposal deliberately fails at the final outbox statement to prove that users, consent, participants, referral state, and proposal data all roll back together.",
            },
            consents: [{ termKey: "speaker-terms", version: "v1" }],
          }),
        }),
      );
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
      expect(
        await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = 'atomic-proposer@example.test'"),
      ).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM session_proposals WHERE title = 'Atomic Proposal Submission Test'"),
      ).toHaveLength(0);
      expect(await queryAll(env.DB, "SELECT id FROM consent_acceptances")).toHaveLength(0);
      expect(await queryAll(env.DB, "SELECT code FROM referral_codes")).toHaveLength(0);
      expect(await queryAll(env.DB, "SELECT id FROM badge_render_jobs")).toHaveLength(0);
      expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER IF EXISTS reject_proposal_submission_email").run();
    }
  });

  it("rejects duplicate participant emails before creating any proposal state", async () => {
    await seedEventAndAdmin(env.DB);
    const response = await mountedAppFetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "direct",
          proposer: {
            firstName: "Duplicate",
            lastName: "Person",
            email: "duplicate-person@example.test",
            role: "proposer",
          },
          proposal: {
            type: "talk",
            title: "Duplicate Participant Integrity Test",
            abstract:
              "This proposal payload is otherwise valid but repeats the proposer email as a co-speaker and must be rejected before any database records are created.",
          },
          speakers: [
            {
              firstName: "Duplicate",
              lastName: "Person",
              email: "DUPLICATE-PERSON@example.test",
              role: "speaker",
              bio: "A sufficiently detailed biography for validating the duplicate participant contract behavior.",
            },
          ],
          consents: [{ termKey: "speaker-terms", version: "v1" }],
        }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(
      await queryAll(env.DB, "SELECT id FROM session_proposals WHERE title = 'Duplicate Participant Integrity Test'"),
    ).toHaveLength(0);
  });

  it("keeps pending proposal speakers off the badge until acceptance", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const proposerId = crypto.randomUUID();
    const speakerId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (
          id, email, normalized_email, first_name, last_name, organization_name, job_title,
          data_json, created_at, updated_at
        ) VALUES
          ('${proposerId}', 'proposer@example.test', 'proposer@example.test', 'Proposer', 'One', 'Org', 'Role', NULL, datetime('now'), datetime('now')),
          ('${speakerId}', 'speaker@example.test', 'speaker@example.test', 'Speaker', 'One', 'Org', 'Role', NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO registrations (
          id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
          custom_answers_json, referred_by_code, confirmation_link_secret,
          manage_link_secret, confirmed_at, cancelled_at, created_at, updated_at
        ) VALUES (
          '${registrationId}', '${eventId}', '${speakerId}', NULL, 'registered', 'virtual',
          'direct', NULL, NULL, NULL, NULL, 'manage-token-hash', datetime('now'), NULL, datetime('now'), datetime('now')
        )
      `),
    ]);

    const { proposal } = await createProposal(env.DB, {
      eventId,
      proposerUserId: proposerId,
      proposalType: "talk",
      title: "Pending talk",
      abstract: "A talk that should not affect badge autodetection until it is accepted.",
    });

    await addProposalSpeaker(env.DB, {
      proposalId: proposal.id,
      userId: speakerId,
      role: "speaker",
    });

    const pendingParticipant = (
      await queryAll<{ status: string }>(
        env.DB,
        `SELECT status FROM event_participant_role_sources
         WHERE event_id = ? AND user_id = ? AND source_kind = 'proposal_speaker' AND role = 'speaker'`,
        [eventId, speakerId],
      )
    )[0];
    expect(pendingParticipant.status).toBe("inactive");

    const adminToken = await createAdminSession(env.DB, adminRow.id, "token-admin-badge-role");

    const pendingResponse = await app.fetch(
      new Request(`https://app.test/api/v1/admin/events/pqc-2026/registrations/${registrationId}/badge-role`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(pendingResponse.status).toBe(200);
    const pendingPayload = (await pendingResponse.json()) as {
      auto_detected: string;
      effective_role: string;
    };
    expect(pendingPayload.auto_detected).toBe("attendee");
    expect(pendingPayload.effective_role).toBe("attendee");

    await finalizeProposalDecision(env.DB, {
      proposalId: proposal.id,
      actor: { identityType: "user", id: adminRow.id, email: "admin@pkic.org", role: "admin" },
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });

    const acceptedParticipant = (
      await queryAll<{ status: string }>(
        env.DB,
        `SELECT status FROM event_participant_role_sources
         WHERE event_id = ? AND user_id = ? AND source_kind = 'proposal_speaker' AND role = 'speaker'`,
        [eventId, speakerId],
      )
    )[0];
    expect(acceptedParticipant.status).toBe("active");

    const acceptedResponse = await app.fetch(
      new Request(`https://app.test/api/v1/admin/events/pqc-2026/registrations/${registrationId}/badge-role`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(acceptedResponse.status).toBe(200);
    const acceptedPayload = (await acceptedResponse.json()) as {
      auto_detected: string;
      effective_role: string;
    };
    expect(acceptedPayload.auto_detected).toBe("speaker");
    expect(acceptedPayload.effective_role).toBe("speaker");

    const overrideResponse = await app.fetch(
      new Request(`https://app.test/api/v1/admin/events/pqc-2026/registrations/${registrationId}/badge-role`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ role: "staff" }),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(overrideResponse.status).toBe(200);
    expect(await overrideResponse.json()).toMatchObject({
      admin_override: "staff",
      auto_detected: "speaker",
      effective_role: "staff",
    });
    expect(
      await queryAll<{ role: string }>(
        env.DB,
        "SELECT role FROM registration_badge_role_overrides WHERE registration_id = ?",
        [registrationId],
      ),
    ).toEqual([{ role: "staff" }]);
    expect(
      await queryAll<{ status: string }>(
        env.DB,
        `SELECT status FROM event_participant_role_sources
         WHERE event_id = ? AND user_id = ? AND source_kind = 'proposal_speaker' AND role = 'speaker'`,
        [eventId, speakerId],
      ),
    ).toEqual([{ status: "active" }]);

    const apiKeyHeaders = {
      authorization: `Bearer ${env.ADMIN_API_KEY ?? "test-admin-key"}`,
      "content-type": "application/json",
    };
    const unattributableSet = await app.fetch(
      new Request(`https://app.test/api/v1/admin/events/pqc-2026/registrations/${registrationId}/badge-role`, {
        method: "PATCH",
        headers: apiKeyHeaders,
        body: JSON.stringify({ role: "moderator" }),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(unattributableSet.status).toBe(403);
    await expect(unattributableSet.json()).resolves.toMatchObject({
      error: { code: "USER_BACKED_ADMIN_REQUIRED" },
    });
    expect(
      await queryAll<{ role: string; set_by_user_id: string }>(
        env.DB,
        "SELECT role, set_by_user_id FROM registration_badge_role_overrides WHERE registration_id = ?",
        [registrationId],
      ),
    ).toEqual([{ role: "staff", set_by_user_id: adminRow.id }]);

    const apiKeyClear = await app.fetch(
      new Request(`https://app.test/api/v1/admin/events/pqc-2026/registrations/${registrationId}/badge-role`, {
        method: "PATCH",
        headers: apiKeyHeaders,
        body: JSON.stringify({ role: "attendee" }),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(apiKeyClear.status).toBe(200);
    await expect(
      queryAll(env.DB, "SELECT role FROM registration_badge_role_overrides WHERE registration_id = ?", [
        registrationId,
      ]),
    ).resolves.toHaveLength(0);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'admin_badge_role_set' ORDER BY created_at, id",
      ),
    ).toEqual([{ actor_id: adminRow.id }, { actor_id: "api-key" }]);
  });
});
