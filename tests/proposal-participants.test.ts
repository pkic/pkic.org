import { prepareProposalProof } from "./helpers/proposal-proof";
import { administratorGrants } from "./helpers/administrator";
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { deliveredEmailPayload, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { proposalAccessReadResponseSchema } from "../assets/shared/schemas/proposal-management";
import { speakerSelfServiceReadResponseSchema } from "../assets/shared/schemas/speaker-self-service";
import { signCapabilityToken } from "../functions/_lib/auth/capability-token";
import {
  addProposalSpeaker,
  createProposal,
  finalizeProposalDecision,
  getProposalByManageToken,
} from "../functions/_lib/services/proposals";
import app from "./helpers/app";
import { renderEmail } from "../functions/_lib/email/render";
import {
  buildProposalInviteEmailContext,
  buildProposalInviteEmailContextMap,
} from "../functions/_lib/services/proposal-invite-email-context";

function mountedAppFetch(request: Request): Promise<Response> {
  return app.fetch(request, env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

const participantProof = (email: string, unaffiliatedAttestation: boolean) =>
  prepareProposalProof({
    environment: env,
    eventSlug: "pqc-2026",
    email,
    consents: [{ termKey: "speaker-terms", version: "v1" }],
    unaffiliatedAttestation,
  });

const hiddenProfile = {
  organizationName: null,
  jobTitle: null,
  bio: null,
  links: [],
  headshotUploaded: false,
  headshotUrl: null,
};

/**
 * A panel whose proposer invites one person with an existing, claimed account and one new address. The
 * existing person also holds `alias-invitee@example.test`, which the proposer may invite instead.
 */
async function submitPanelWithExistingInvitee(invitedAddress = "private-invitee@example.test") {
  await seedEventAndAdmin(env.DB);
  const existingId = crypto.randomUUID();
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, email_verified_at, created_at, updated_at)
       VALUES (?1, 'private-invitee@example.test', 'private-invitee@example.test', 'Private', 'Stored', ?2, ?2, ?2)`,
    ).bind(existingId, at),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, biography, links_json, source, show_on_organization_profile,
                               invited_at, started_at, created_at, updated_at)
       VALUES (?1, ?2, NULL, 'A private biography that only this person may share.', '["https://private.example"]',
               'account', 0, ?3, ?3, ?3, ?3)`,
    ).bind(crypto.randomUUID(), existingId, at),
    env.DB.prepare(
      `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at)
       VALUES (?1, ?2, 'alias-invitee@example.test', 'alias-invitee@example.test', ?3, ?3)`,
    ).bind(crypto.randomUUID(), existingId, at),
  ]);
  const response = await mountedAppFetch(
    new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(await participantProof("view-lead@example.test", true)),
        sourceType: "direct",
        proposer: {
          firstName: "View",
          lastName: "Lead",
          email: "view-lead@example.test",
          actingIdentityId: null,
          bio: "Leads cross-industry cryptography migration planning and public policy coordination programs.",
          role: "moderator",
        },
        proposal: {
          type: "panel",
          title: "Panel: What The Proposer Sees",
          abstract:
            "Panel discussion on organizational governance, procurement, stakeholder management, and transition planning for post-quantum cryptography programs.",
        },
        speakers: [
          { firstName: "Typed", lastName: "Name", email: invitedAddress, role: "panelist" },
          { firstName: "Fresh", lastName: "Invitee", email: "fresh-invitee@example.test", role: "panelist" },
        ],
        consents: [{ termKey: "speaker-terms", version: "v1" }],
      }),
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const { proposalId } = (await response.json()) as { proposalId: string };
  const proposerId = (await env.DB.prepare("SELECT proposer_user_id FROM session_proposals WHERE id=?")
    .bind(proposalId)
    .first<string>("proposer_user_id"))!;
  const session = await createMemberSession(env.DB, proposerId, crypto.randomUUID(), undefined, null);
  const read = async () => {
    const view = await mountedAppFetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/submission`, {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
    expect(view.status, await view.clone().text()).toBe(200);
    return proposalAccessReadResponseSchema.parse(await view.json()).speakers;
  };
  return { proposalId, proposerId, existingId, read };
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
        actingIdentityId: null,
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
    const request = async (email: string, type: string) =>
      app.fetch(
        new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...proposalBody(email, type), ...(await participantProof(email, true)) }),
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
    await env.DB.prepare(
      "UPDATE users SET first_name = 'Canonical', last_name = 'Proposer' WHERE normalized_email = 'admin@pkic.org'",
    ).run();

    const response = await mountedAppFetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(await participantProof("admin@pkic.org", true)),
          sourceType: "direct",
          proposer: {
            firstName: "Claimed",
            lastName: "Admin",
            email: "admin@pkic.org",
            actingIdentityId: null,
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
      queryAll<{ first_name: string | null }>(
        env.DB,
        "SELECT first_name FROM users WHERE normalized_email = ?",
        "admin@pkic.org",
      ),
    ).resolves.toEqual([{ first_name: "Canonical" }]);
  });

  it("renders public proposal and participant fields literally while retaining trusted management links", async () => {
    await seedEventAndAdmin(env.DB);
    const attackerUrl = "https://attacker.invalid/proposal";
    const response = await mountedAppFetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(await participantProof("literal-proposer@literal-security.test", false)),
          sourceType: "direct",
          proposer: {
            firstName: "Lead",
            lastName: "Reviewer",
            email: "literal-proposer@literal-security.test",
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
              role: "speaker",
            },
          ],
          consents: [{ termKey: "speaker-terms", version: "v1" }],
        }),
      }),
    );
    expect(response.status).toBe(200);

    await expect(
      queryAll<{ organization_name: string; job_title: string; started_at: string | null }>(
        env.DB,
        `SELECT organization.name AS organization_name, identity.job_title, identity.started_at
       FROM identities identity JOIN organizations organization ON organization.id = identity.organization_id
       JOIN users person ON person.id = identity.user_id WHERE person.normalized_email = ?`,
        "literal-proposer@literal-security.test",
      ),
    ).resolves.toEqual([
      { organization_name: "<script>alert(1)</script>", job_title: "Engineer", started_at: expect.any(String) },
    ]);

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

  it("supports panel participants and stores only the proposer's own profile links", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await mountedAppFetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(await participantProof("lead@example.test", true)),
          sourceType: "direct",
          proposer: {
            firstName: "Panel",
            lastName: "Lead",
            email: "lead@example.test",
            actingIdentityId: null,
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
            },
            {
              firstName: "Moderator",
              lastName: "One",
              email: "moderator@example.test",
              role: "moderator",
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

    // The proposer's own links are stored; an invited speaker writes their own profile when they confirm.
    const profileRows = await queryAll<{ email: string; biography: string | null; links_json: string | null }>(
      env.DB,
      `SELECT person.normalized_email AS email, identity.biography, identity.links_json
         FROM identities identity JOIN users person ON person.id = identity.user_id
        WHERE person.normalized_email IN ('lead@example.test', 'panelist1@example.test', 'moderator@example.test')
        ORDER BY person.normalized_email`,
    );
    expect(profileRows.find((row) => row.email === "lead@example.test")?.links_json).toContain("example.test/lead");
    for (const email of ["panelist1@example.test", "moderator@example.test"])
      for (const row of profileRows.filter((entry) => entry.email === email))
        expect(row).toMatchObject({ biography: null, links_json: null });
  });

  it("shows invitees only confirmed speakers and the proposer only the names they typed", async () => {
    await seedEventAndAdmin(env.DB);
    // An existing account whose stored name is not what the proposer typed.
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, email_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, 'Private', 'Stored', datetime('now'), datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), "existing-invitee@example.test", "existing-invitee@example.test")
      .run();
    const response = await mountedAppFetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(await participantProof("lineup-lead@example.test", true)),
          sourceType: "direct",
          proposer: {
            firstName: "Lineup",
            lastName: "Lead",
            email: "lineup-lead@example.test",
            actingIdentityId: null,
            bio: "Leads cross-industry cryptography migration planning and public policy coordination programs.",
            role: "moderator",
          },
          proposal: {
            type: "panel",
            title: "Panel: Who Is On The Lineup",
            abstract:
              "Panel discussion on organizational governance, procurement, stakeholder management, and transition planning for post-quantum cryptography programs.",
          },
          speakers: [
            { firstName: "Typed", lastName: "Existing", email: "existing-invitee@example.test", role: "panelist" },
            { firstName: "New", lastName: "Invitee", email: "new-invitee@example.test", role: "panelist" },
          ],
          consents: [{ termKey: "speaker-terms", version: "v1" }],
        }),
      }),
    );
    expect(response.status, await response.clone().text()).toBe(200);

    const lineups = await queryAll<{ template_key: string; recipient_email: string; lineup: string }>(
      env.DB,
      `SELECT template_key, recipient_email,
              json_extract(payload_json, '$.speakerLineupText.__pkicEmailPlainText') AS lineup
         FROM email_outbox WHERE template_key IN ('proposal_submitted', 'co_speaker_invite')
        ORDER BY template_key, recipient_email`,
    );
    const invites = lineups.filter((row) => row.template_key === "co_speaker_invite");
    expect(invites.map((row) => row.recipient_email)).toEqual([
      "existing-invitee@example.test",
      "new-invitee@example.test",
    ]);
    for (const invite of invites) {
      // Another invitee, or anyone's address, is never shown to an invitee.
      expect(invite.lineup).not.toMatch(/@|Invitee|Existing|Private|Stored/);
    }
    const submitted = lineups.find((row) => row.template_key === "proposal_submitted")!;
    expect(submitted.lineup).toContain("- Typed Existing");
    expect(submitted.lineup).toContain("- New Invitee");
    expect(submitted.lineup).not.toMatch(/@|Private|Stored/);

    // Later invitations and reminders read the same lineup: confirmed speakers by name only.
    const { proposalId } = (await response.json()) as { proposalId: string };
    await env.DB.prepare(
      "UPDATE proposal_speakers SET status='confirmed' WHERE proposal_id=? AND user_id=(SELECT id FROM users WHERE normalized_email='new-invitee@example.test')",
    )
      .bind(proposalId)
      .run();
    const context = await buildProposalInviteEmailContext(env.DB, { proposalId });
    expect(context.speakerLineupText).toContain("- New Invitee");
    expect(context.speakerLineupText).not.toMatch(/@|Private|Stored|Existing/);
    const mapped = await buildProposalInviteEmailContextMap(env.DB, [proposalId]);
    expect(mapped.get(proposalId)?.speakerLineupText).toBe(context.speakerLineupText);
  });

  it("shows the proposer only the address of an invitee with an existing account until they accept", async () => {
    const { existingId, read } = await submitPanelWithExistingInvitee();
    const invited = await read();
    expect(invited.find((speaker) => speaker.email === "private-invitee@example.test")).toMatchObject({
      status: "invited",
      firstName: null,
      lastName: null,
      ...hiddenProfile,
    });
    // An account the invitation made carries only the name the proposer typed.
    expect(invited.find((speaker) => speaker.email === "fresh-invitee@example.test")).toMatchObject({
      status: "invited",
      firstName: "Fresh",
      lastName: "Invitee",
      ...hiddenProfile,
    });

    await env.DB.prepare("UPDATE proposal_speakers SET status='confirmed', confirmed_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), existingId)
      .run();
    expect((await read()).find((speaker) => speaker.email === "private-invitee@example.test")).toMatchObject({
      status: "confirmed",
      firstName: "Private",
      lastName: "Stored",
    });
  });

  it("keeps an existing person's profile from the proposer after they decline without accepting", async () => {
    const { existingId, read } = await submitPanelWithExistingInvitee();
    await env.DB.prepare("UPDATE proposal_speakers SET status='declined', declined_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), existingId)
      .run();
    expect((await read()).find((speaker) => speaker.email === "private-invitee@example.test")).toMatchObject({
      status: "declined",
      firstName: null,
      lastName: null,
      ...hiddenProfile,
    });
  });

  it("shows the proposer the address they invited, not the account's primary one, until the speaker accepts", async () => {
    const { existingId, read } = await submitPanelWithExistingInvitee("alias-invitee@example.test");
    const invitee = async () => (await read()).find((speaker) => speaker.userId === existingId);
    expect(await invitee()).toMatchObject({ status: "invited", email: "alias-invitee@example.test" });

    await env.DB.prepare("UPDATE proposal_speakers SET status='declined', declined_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), existingId)
      .run();
    expect(await invitee()).toMatchObject({ status: "declined", email: "alias-invitee@example.test" });

    await env.DB.prepare("UPDATE proposal_speakers SET status='confirmed', confirmed_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), existingId)
      .run();
    expect(await invitee()).toMatchObject({ status: "confirmed", email: "private-invitee@example.test" });
  });

  it("names another speaker on a speaker link only after they accept or by the name the proposer typed", async () => {
    const { proposalId, proposerId, existingId } = await submitPanelWithExistingInvitee();
    const proposerSpeaker = (await env.DB.prepare(
      "SELECT id, manage_link_secret FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
    )
      .bind(proposalId, proposerId)
      .first<{ id: string; manage_link_secret: string }>())!;
    const token = await signCapabilityToken({
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      linkSecret: proposerSpeaker.manage_link_secret,
      purpose: "speaker_manage",
      resourceId: proposerSpeaker.id,
    });
    const coSpeakers = async () => {
      const response = await mountedAppFetch(
        new Request(`https://app.test/api/v1/proposals/speakers/access/${encodeURIComponent(token)}`),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      return speakerSelfServiceReadResponseSchema.parse(await response.json()).proposal.coSpeakers;
    };
    expect(await coSpeakers()).toEqual([
      { firstName: null, lastName: null, status: "invited" },
      { firstName: "Fresh", lastName: "Invitee", status: "invited" },
    ]);

    await env.DB.prepare("UPDATE proposal_speakers SET status='declined', declined_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), existingId)
      .run();
    expect((await coSpeakers())[0]).toEqual({ firstName: null, lastName: null, status: "declined" });

    await env.DB.prepare("UPDATE proposal_speakers SET status='confirmed', confirmed_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), existingId)
      .run();
    expect((await coSpeakers())[0]).toEqual({ firstName: "Private", lastName: "Stored", status: "confirmed" });
  });

  it("does not clear an existing proposer's identity biography or links when the submission provides none", async () => {
    await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(
        "11111111-1111-4111-8111-111111111111",
        "existing-proposer@example.test",
        "existing-proposer@example.test",
        "Existing",
        "Proposer",
      ),
      env.DB.prepare(
        `INSERT INTO identities (id, user_id, organization_id, biography, links_json, source, show_on_organization_profile,
                                 invited_at, started_at, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 'account', 0, datetime('now'), datetime('now'), datetime('now'), datetime('now'))`,
      ).bind(
        crypto.randomUUID(),
        "11111111-1111-4111-8111-111111111111",
        "Existing biography that should remain attached to the identity.",
        JSON.stringify(["https://example.test/existing", "https://github.com/existing"]),
      ),
    ]);

    const response = await mountedAppFetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(await participantProof("existing-proposer@example.test", true)),
          sourceType: "direct",
          proposer: {
            firstName: "Existing",
            lastName: "Proposer",
            email: "existing-proposer@example.test",
            actingIdentityId: null,
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
        "SELECT biography, links_json FROM identities WHERE user_id = ? AND organization_id IS NULL",
        ["11111111-1111-4111-8111-111111111111"],
      )
    )[0];
    expect(row.biography).toBe("Existing biography that should remain attached to the identity.");
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

    const proof = await participantProof("atomic-proposer@example.test", true);
    const proofOutbox = await queryAll(env.DB, "SELECT id FROM email_outbox ORDER BY id");
    try {
      const response = await mountedAppFetch(
        new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...proof,
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
      expect(await queryAll(env.DB, "SELECT id FROM email_outbox ORDER BY id")).toEqual(proofOutbox);
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
          ...(await participantProof("duplicate-person@example.test", true)),
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
          id, email, normalized_email, first_name, last_name,
          data_json, created_at, updated_at
        ) VALUES
          ('${proposerId}', 'proposer@example.test', 'proposer@example.test', 'Proposer', 'One', NULL, datetime('now'), datetime('now')),
          ('${speakerId}', 'speaker@example.test', 'speaker@example.test', 'Speaker', 'One', NULL, datetime('now'), datetime('now'))
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
      new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/badge`, {
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
      actor: {
        identityType: "user",
        id: adminRow.id,
        email: "admin@pkic.org",
        grants: administratorGrants,
      },
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
      new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/badge`, {
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
      new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/badge`, {
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
      new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/badge`, {
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
      new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/badge`, {
        method: "PATCH",
        headers: apiKeyHeaders,
        body: JSON.stringify({ role: "attendee" }),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(apiKeyClear.status).toBe(403);
    await expect(apiKeyClear.json()).resolves.toMatchObject({
      error: { code: "USER_BACKED_ADMIN_REQUIRED" },
    });
    await expect(
      queryAll(env.DB, "SELECT role FROM registration_badge_role_overrides WHERE registration_id = ?", [
        registrationId,
      ]),
    ).resolves.toEqual([{ role: "staff" }]);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'admin_badge_role_set' ORDER BY created_at, id",
      ),
    ).toEqual([{ actor_id: adminRow.id }]);
  });
});
