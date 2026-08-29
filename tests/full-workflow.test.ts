import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createContext, deliveredEmailPayload, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import { onRequestGet as referralRedirect } from "../functions/r/[code]";
import { queueEmail } from "../functions/_lib/email/outbox";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import app from "../functions/router";
import { createGroup } from "../functions/_lib/services/groups";

interface VerifyAdminPayload {
  token: string;
}

interface CreateRegistrationPayload {
  registrationId: string;
  status: string;
  manageToken: string;
  shareUrl: string;
}

interface ProposalPayload {
  proposalId: string;
}

async function seedTemplate(adminId: string, key: string, content: string, subjectTemplate?: string): Promise<void> {
  const version = await createTemplateVersion(env.DB, {
    templateKey: key,
    content,
    subjectTemplate: subjectTemplate ?? null,
    createdByUserId: adminId,
  });

  await activateTemplateVersion(env.DB, {
    templateKey: key,
    version: version.version,
  });
}

async function seedRequiredEmailTemplates(adminId: string): Promise<void> {
  await seedTemplate(adminId, "email_layout", "{{{body_html}}}", "Email layout");
  await seedTemplate(adminId, "partial_reg_details", "Registration details", "Partial: registration details");
  await seedTemplate(adminId, "partial_sponsors_block", "Sponsors block", "Partial: sponsors block");
  await seedTemplate(adminId, "partial_about_pkic", "About PKIC", "Partial: about PKIC");
  await seedTemplate(adminId, "partial_donation_request", "Donation request", "Partial: donation request");
  await seedTemplate(
    adminId,
    "admin_magic_link",
    "Click [sign in]({{magicLinkUrl}}). Expires in {{expiresInMinutes}} minutes.",
    "Admin sign-in link",
  );
  await seedTemplate(adminId, "speaker_invite", "Submit your talk: {{proposalUrl}}", "Speaker invitation");
  await seedTemplate(
    adminId,
    "proposal_submitted",
    "Proposal **{{proposalTitle}}** submitted. Manage: {{manageUrl}}",
    "Proposal submitted",
  );
  await seedTemplate(
    adminId,
    "proposal_decision",
    "Decision for **{{proposalTitle}}**: {{finalStatus}}. {{decisionNote}}",
    "Proposal decision",
  );
  await seedTemplate(
    adminId,
    "registration_confirm_email",
    "Confirm registration: {{confirmationUrl}}",
    "Confirm registration",
  );
  await seedTemplate(
    adminId,
    "registration_confirmed",
    "Registration confirmed for {{eventName}}. Manage: {{manageUrl}}",
    "Registration confirmed",
  );
  await seedTemplate(adminId, "attendee_invite", "Join event: {{registrationUrl}}", "Attendee invite");
  await seedTemplate(
    adminId,
    "registration_updated",
    "Registration updated for {{eventName}}. Status: {{status}}",
    "Registration updated",
  );
}

async function extractTokenFromOutboxUrl(payloadJson: string, fieldName: string): Promise<string> {
  const payload = await deliveredEmailPayload<Record<string, string>>(env.DB, env, payloadJson);
  const url = new URL(payload[fieldName]);
  const fragmentQuery = url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "";
  const token = url.searchParams.get("token") ?? new URLSearchParams(fragmentQuery).get("token");
  if (!token) {
    throw new Error(`Missing token in ${fieldName}`);
  }
  return token;
}

async function callMountedApp(request: Request): Promise<Response> {
  return app.fetch(request, env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

describe("full workflow", () => {
  it("runs end-to-end attendee and speaker workflows", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const adminUser = (
      await queryAll<{ id: string; email: string }>(
        env.DB,
        "SELECT id, email FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
      )
    )[0];
    const ownerGroup = await createGroup(
      env.DB,
      { identityType: "user", id: adminUser.id, email: adminUser.email, role: "admin" },
      {
        typeKey: "working_group",
        name: `Full workflow ${crypto.randomUUID()}`,
        visibility: "authenticated",
        eligibilityMode: "open",
      },
    );
    await env.DB.prepare("UPDATE events SET owner_group_id = ? WHERE id = ?").bind(ownerGroup.id, eventId).run();
    await seedRequiredEmailTemplates(adminUser.id);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "x-message-id": "msg-test-1" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const requestLinkResponse = await callMountedApp(
        new Request("https://app.test/api/v1/auth/request-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "admin@pkic.org" }),
        }),
      );
      expect(requestLinkResponse.status).toBe(200);

      const magicLinkOutbox = (
        await queryAll<{ payload_json: string }>(
          env.DB,
          "SELECT payload_json FROM email_outbox WHERE template_key = 'user_magic_link' ORDER BY created_at DESC LIMIT 1",
        )
      )[0];
      const magicToken = await extractTokenFromOutboxUrl(magicLinkOutbox.payload_json, "magicLinkUrl");

      const verifyResponse = await callMountedApp(
        new Request("https://app.test/api/v1/auth/verify-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: magicToken } as VerifyAdminPayload),
        }),
      );
      expect(verifyResponse.status).toBe(200);
      await verifyResponse.json();
      const adminSessionCookie = verifyResponse.headers.get("set-cookie") ?? "";
      const adminSessionToken = decodeURIComponent(adminSessionCookie.match(/^pkic_session=([^;]+)/)?.[1] ?? "");

      const reviewerUserId = crypto.randomUUID();
      await env.DB.prepare(
        `
      INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
      VALUES ('${reviewerUserId}', 'reviewer2@pkic.org', 'reviewer2@pkic.org', 'admin', 1, datetime('now'), datetime('now'));
    `,
      ).run();
      const reviewerToken = await createAdminSession(env.DB, reviewerUserId, "reviewer-2-token");

      const speakerInvites = [
        { email: "speaker@example.test", firstName: "Speaker", lastName: "One", sourceType: "direct" },
      ];
      const speakerInvitationBase = `/api/v1/groups/${ownerGroup.id}/events/${eventId}/invites/speakers`;
      const speakerPreviewResponse = await app.fetch(
        new Request(`https://app.test${speakerInvitationBase}/preview`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: adminSessionCookie },
          body: JSON.stringify({ invites: speakerInvites }),
        }),
        env as any,
        { passThroughOnException: () => {}, waitUntil: () => {} } as any,
      );
      expect(speakerPreviewResponse.status).toBe(200);
      const speakerPreview = (await speakerPreviewResponse.json()) as {
        previewToken: string;
        inviteDigest: string;
      };
      const speakerInviteResponse = await app.fetch(
        new Request(`https://app.test${speakerInvitationBase}/bulk`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: adminSessionCookie,
          },
          body: JSON.stringify({
            invites: speakerInvites,
            previewToken: speakerPreview.previewToken,
            inviteDigest: speakerPreview.inviteDigest,
          }),
        }),
        env as any,
        { passThroughOnException: () => {}, waitUntil: () => {} } as any,
      );
      expect(speakerInviteResponse.status).toBe(200);
      await speakerInviteResponse.json();
      const speakerInvite = (
        await queryAll<{ id: string }>(
          env.DB,
          "SELECT id FROM invites WHERE event_id = ? AND invitee_email = ? AND invite_type = 'speaker' LIMIT 1",
          eventId,
          "speaker@example.test",
        )
      )[0];
      const speakerInviteToken = await issueDatabaseCapability({
        db: env.DB,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        purpose: "invite",
        resourceId: speakerInvite.id,
      });

      const proposalResponse = await callMountedApp(
        new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            inviteToken: speakerInviteToken,
            proposer: {
              firstName: "Speaker",
              lastName: "One",
              email: "speaker@example.test",
              organizationName: "Government Agency",
              jobTitle: "Engineer",
              bio: "Experienced speaker focused on practical post-quantum migration and governance.",
            },
            proposal: {
              type: "talk",
              title: "Post-Quantum Migration",
              abstract:
                "A practical migration blueprint covering inventory, risk profiling, dual-stack rollout, crypto-agility governance, and operational playbooks for enterprise PKI teams.",
            },
            consents: [{ termKey: "speaker-terms", version: "v1" }],
          }),
        }),
      );
      expect(proposalResponse.status).toBe(200);
      const createdProposal = (await proposalResponse.json()) as ProposalPayload;

      const reviewOneResponse = await callMountedApp(
        new Request(`https://app.test/api/v1/proposals/${createdProposal.proposalId}/reviews`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: adminSessionCookie,
          },
          body: JSON.stringify({
            recommendation: "accept",
            score: 9,
            reviewerComment: "Strong proposal",
          }),
        }),
      );
      expect(reviewOneResponse.status).toBe(200);

      const reviewTwoResponse = await callMountedApp(
        new Request(`https://app.test/api/v1/proposals/${createdProposal.proposalId}/reviews`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${reviewerToken}`,
          },
          body: JSON.stringify({
            recommendation: "accept",
            score: 8,
            reviewerComment: "Also strong",
          }),
        }),
      );
      expect(reviewTwoResponse.status).toBe(200);

      const finalizeResponse = await callMountedApp(
        new Request(`https://app.test/api/v1/proposals/${createdProposal.proposalId}/decisions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: adminSessionCookie,
          },
          body: JSON.stringify({
            finalStatus: "accepted",
            decisionNote: "Approved by committee",
          }),
        }),
      );
      expect(finalizeResponse.status).toBe(200);

      const registrationOneResponse = await callMountedApp(
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Attendee",
            lastName: "One",
            email: "attendee1@pkic.org",
            attendanceType: "in_person",
            sourceType: "direct",
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
          }),
        }),
      );
      const registrationOnePayload = (await registrationOneResponse.json()) as CreateRegistrationPayload;
      expect(registrationOnePayload.status).toBe("pending_email_confirmation");

      const firstConfirmationPayload = (
        await queryAll<{ payload_json: string }>(
          env.DB,
          "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' AND recipient_email = 'attendee1@pkic.org' ORDER BY created_at DESC LIMIT 1",
        )
      )[0];
      const firstConfirmationToken = await extractTokenFromOutboxUrl(
        firstConfirmationPayload.payload_json,
        "confirmationUrl",
      );

      const firstConfirmResponse = await callMountedApp(
        new Request(
          `https://app.test/api/v1/events/pqc-2026/registrations/confirm-email?token=${encodeURIComponent(
            firstConfirmationToken,
          )}`,
          { method: "GET" },
        ),
      );
      const firstConfirmPayload = (await firstConfirmResponse.json()) as { status: string; manageToken: string };
      expect(firstConfirmPayload.status).toBe("registered");

      const inviteFromAttendeeResponse = await callMountedApp(
        new Request("https://app.test/api/v1/events/pqc-2026/invites", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${firstConfirmPayload.manageToken}`,
          },
          body: JSON.stringify({
            invites: [{ email: "friend@example.test", firstName: "Friend", lastName: "User" }],
          }),
        }),
      );
      expect(inviteFromAttendeeResponse.status).toBe(200);
      const inviteFromAttendeePayload = (await inviteFromAttendeeResponse.json()) as { referralCode: string };
      expect(inviteFromAttendeePayload.referralCode).toHaveLength(7);

      const registrationTwoResponse = await callMountedApp(
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Attendee",
            lastName: "Two",
            email: "attendee2@pkic.org",
            attendanceType: "in_person",
            sourceType: "direct",
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
          }),
        }),
      );
      await registrationTwoResponse.json();

      const secondConfirmationPayload = (
        await queryAll<{ payload_json: string }>(
          env.DB,
          "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' AND recipient_email = 'attendee2@pkic.org' ORDER BY created_at DESC LIMIT 1",
        )
      )[0];
      const secondConfirmationToken = await extractTokenFromOutboxUrl(
        secondConfirmationPayload.payload_json,
        "confirmationUrl",
      );

      const secondConfirmResponse = await callMountedApp(
        new Request(
          `https://app.test/api/v1/events/pqc-2026/registrations/confirm-email?token=${encodeURIComponent(
            secondConfirmationToken,
          )}`,
          { method: "GET" },
        ),
      );
      const secondConfirmPayload = (await secondConfirmResponse.json()) as { status: string };
      expect(secondConfirmPayload.status).toBe("registered");

      const cancelRegistrationResponse = await callMountedApp(
        new Request(`https://app.test/api/v1/registrations/manage/${firstConfirmPayload.manageToken}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        }),
      );
      expect(cancelRegistrationResponse.status).toBe(200);

      const referralCode = registrationOnePayload.shareUrl.split("/").pop() as string;
      const referralResponse = await referralRedirect(
        createContext(env, new Request(`https://app.test/r/${referralCode}`), { code: referralCode }),
      );
      expect(referralResponse.status).toBe(200);
      expect(await referralResponse.text()).toContain('http-equiv="refresh"');

      await queueEmail(env.DB, {
        eventId,
        templateKey: "registration_updated",
        recipientEmail: "ops@pkic.org",
        subject: "Queued workflow check",
        messageType: "transactional",
        data: {
          eventName: "PQC Conference 2026",
          status: "registered",
        },
      });

      const retryResponse = await app.fetch(
        new Request("https://app.test/api/v1/email/outbox/process", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${adminSessionToken}`,
          },
          body: JSON.stringify({ limit: 50 }),
        }),
        env,
        { passThroughOnException() {}, waitUntil() {} } as any,
      );
      expect(retryResponse.status).toBe(200);

      const retryPayload = (await retryResponse.json()) as { processed: number };
      expect(retryPayload.processed).toBeGreaterThan(0);
      expect(fetchMock).toHaveBeenCalled();

      const proposalStatus = (
        await queryAll<{ status: string }>(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [
          createdProposal.proposalId,
        ])
      )[0];
      expect(proposalStatus.status).toBe("accepted");

      const referralClicks = (
        await queryAll<{ clicks: number }>(env.DB, "SELECT clicks FROM referral_codes WHERE code = ?", [referralCode])
      )[0];
      expect(Number(referralClicks.clicks)).toBeGreaterThan(0);

      const eventRegistrations = (
        await queryAll<{ total: number }>(env.DB, "SELECT COUNT(*) AS total FROM registrations WHERE event_id = ?", [
          eventId,
        ])
      )[0];
      expect(Number(eventRegistrations.total)).toBeGreaterThanOrEqual(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
