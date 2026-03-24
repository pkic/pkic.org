import { describe, it, expect } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { onRequestPost as submitProposal } from "../functions/api/v1/events/[eventSlug]/proposals";
import { onRequestGet as getBadgeRole } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/badge-role";
import { addProposalSpeaker, createProposal, finalizeProposalDecision } from "../functions/_lib/services/proposals";

describe("proposal participants", () => {
  it("supports panel participants and stores user links", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    const env = createEnv(db);

    const response = await submitProposal(
      createContext(
        env,
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
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { proposalId: string };

    const roles = db.raw<{ role: string }>(
      "SELECT role FROM proposal_speakers WHERE proposal_id = ? ORDER BY role",
      [payload.proposalId],
    );
    expect(roles.map((entry) => entry.role)).toContain("panelist");
    expect(roles.map((entry) => entry.role)).toContain("moderator");

    const participantRoles = db.raw<{ role: string }>(
      "SELECT role FROM event_participants WHERE event_id = (SELECT event_id FROM session_proposals WHERE id = ?) ORDER BY role",
      [payload.proposalId],
    );
    expect(participantRoles.map((entry) => entry.role)).toContain("panelist");
    expect(participantRoles.map((entry) => entry.role)).toContain("moderator");

    const linkRows = db.raw<{ links_json: string | null }>(
      "SELECT links_json FROM users WHERE id IN (SELECT user_id FROM proposal_speakers WHERE proposal_id = ?)",
      [payload.proposalId],
    );
    expect(linkRows.some((entry) => Boolean(entry.links_json))).toBe(true);
  });

  it("keeps pending proposal speakers off the badge until acceptance", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const proposerId = crypto.randomUUID();
    const speakerId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const adminRow = db.raw<{ id: string }>("SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")[0];

    await db.exec?.(`
      INSERT INTO users (
        id, email, normalized_email, first_name, last_name, organization_name, job_title,
        data_json, created_at, updated_at
      ) VALUES
        ('${proposerId}', 'proposer@example.test', 'proposer@example.test', 'Proposer', 'One', 'Org', 'Role', NULL, datetime('now'), datetime('now')),
        ('${speakerId}', 'speaker@example.test', 'speaker@example.test', 'Speaker', 'One', 'Org', 'Role', NULL, datetime('now'), datetime('now'));

      INSERT INTO registrations (
        id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
        custom_answers_json, referred_by_code, confirmation_token_hash, confirmation_token_expires_at,
        manage_token_hash, confirmed_at, cancelled_at, created_at, updated_at
      ) VALUES (
        '${registrationId}', '${eventId}', '${speakerId}', NULL, 'registered', 'virtual',
        'direct', NULL, NULL, NULL, NULL, NULL, 'manage-token-hash', datetime('now'), NULL, datetime('now'), datetime('now')
      );
    `);

    const { proposal } = await createProposal(db, {
      eventId,
      proposerUserId: proposerId,
      proposalType: "talk",
      title: "Pending talk",
      abstract: "A talk that should not affect badge autodetection until it is accepted.",
    });

    await addProposalSpeaker(db, {
      proposalId: proposal.id,
      userId: speakerId,
      role: "speaker",
    });

    const pendingParticipant = db.raw<{ status: string }>(
      "SELECT status FROM event_participants WHERE event_id = ? AND user_id = ? AND source_type = 'proposal' AND role = 'speaker'",
      [eventId, speakerId],
    )[0];
    expect(pendingParticipant.status).toBe("inactive");

    await createAdminSession(db, adminRow.id, "token-admin-badge-role");

    const pendingResponse = await getBadgeRole(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/events/pqc-2026/registrations/${registrationId}/badge-role`, {
          headers: { authorization: "Bearer token-admin-badge-role" },
        }),
        { eventSlug: "pqc-2026", registrationId },
      ),
    );

    expect(pendingResponse.status).toBe(200);
    const pendingPayload = await pendingResponse.json() as {
      auto_detected: string;
      effective_role: string;
    };
    expect(pendingPayload.auto_detected).toBe("attendee");
    expect(pendingPayload.effective_role).toBe("attendee");

    await finalizeProposalDecision(db, {
      proposalId: proposal.id,
      decidedByUserId: adminRow.id,
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });

    const acceptedParticipant = db.raw<{ status: string }>(
      "SELECT status FROM event_participants WHERE event_id = ? AND user_id = ? AND source_type = 'proposal' AND role = 'speaker'",
      [eventId, speakerId],
    )[0];
    expect(acceptedParticipant.status).toBe("active");

    const acceptedResponse = await getBadgeRole(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/events/pqc-2026/registrations/${registrationId}/badge-role`, {
          headers: { authorization: "Bearer token-admin-badge-role" },
        }),
        { eventSlug: "pqc-2026", registrationId },
      ),
    );

    expect(acceptedResponse.status).toBe(200);
    const acceptedPayload = await acceptedResponse.json() as {
      auto_detected: string;
      effective_role: string;
    };
    expect(acceptedPayload.auto_detected).toBe("speaker");
    expect(acceptedPayload.effective_role).toBe("speaker");
  });
});
