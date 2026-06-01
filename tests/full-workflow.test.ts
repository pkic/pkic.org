import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import { onRequestPost as requestAdminLink } from "../functions/api/v1/admin/auth/request-link";
import { onRequestPost as verifyAdminLink } from "../functions/api/v1/admin/auth/verify-link";
import { onRequestPost as inviteSpeakersBulk } from "../functions/api/v1/admin/events/[eventSlug]/invites/speakers/bulk";
import { onRequestPost as addProposalReview } from "../functions/api/v1/admin/proposals/[proposalId]/reviews";
import { onRequestPost as finalizeProposal } from "../functions/api/v1/admin/proposals/[proposalId]/finalize";
import { onRequestPost as submitProposal } from "../functions/api/v1/events/[eventSlug]/proposals";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequest as confirmRegistrationEmail } from "../functions/api/v1/events/[eventSlug]/registrations/confirm-email";
import { onRequestPatch as manageRegistration } from "../functions/api/v1/registrations/manage/[token]";
import { onRequestPost as inviteAttendeesFromRegistration } from "../functions/api/v1/events/[eventSlug]/invites";
import { onRequestGet as referralRedirect } from "../functions/r/[code]";
import { onRequestPost as retryPendingEmail } from "../functions/api/v1/internal/email/retry";
import { queueEmail } from "../functions/_lib/email/outbox";

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

function extractTokenFromOutboxUrl(payloadJson: string, fieldName: string): string {
  const payload = JSON.parse(payloadJson) as Record<string, string>;
  const url = new URL(payload[fieldName]);
  const token = url.searchParams.get("token");
  if (!token) {
    throw new Error(`Missing token in ${fieldName}`);
  }
  return token;
}

describe("full workflow", () => {
  it("runs end-to-end attendee and speaker workflows", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const adminUser = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    await seedRequiredEmailTemplates(adminUser.id);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "x-message-id": "msg-test-1" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const requestLinkResponse = await requestAdminLink(
        createContext(
          env,
          new Request("https://app.test/api/v1/admin/auth/request-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "admin@pkic.org" }),
          }),
          {},
        ),
      );
      expect(requestLinkResponse.status).toBe(200);

      const magicLinkOutbox = (
        await queryAll<{ payload_json: string }>(
          env.DB,
          "SELECT payload_json FROM email_outbox WHERE template_key = 'admin_magic_link' ORDER BY created_at DESC LIMIT 1",
        )
      )[0];
      const magicToken = extractTokenFromOutboxUrl(magicLinkOutbox.payload_json, "magicLinkUrl");

      const verifyResponse = await verifyAdminLink(
        createContext(
          env,
          new Request("https://app.test/api/v1/admin/auth/verify-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: magicToken } as VerifyAdminPayload),
          }),
          {},
        ),
      );
      expect(verifyResponse.status).toBe(200);
      await verifyResponse.json();
      const adminSessionCookie = verifyResponse.headers.get("set-cookie") ?? "";
      const adminSessionToken = decodeURIComponent(adminSessionCookie.match(/^pkic_admin_session=([^;]+)/)?.[1] ?? "");

      const reviewerUserId = crypto.randomUUID();
      await env.DB.prepare(
        `
      INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
      VALUES ('${reviewerUserId}', 'reviewer2@pkic.org', 'reviewer2@pkic.org', 'admin', 1, datetime('now'), datetime('now'));
    `,
      ).run();
      const reviewerToken = await createAdminSession(env.DB, reviewerUserId, "reviewer-2-token");

      const speakerInviteResponse = await inviteSpeakersBulk(
        createContext(
          env,
          new Request("https://app.test/api/v1/admin/events/pqc-2026/invites/speakers/bulk", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: adminSessionCookie,
            },
            body: JSON.stringify({
              invites: [{ email: "speaker@example.test", firstName: "Speaker", lastName: "One", sourceType: "direct" }],
            }),
          }),
          { eventSlug: "pqc-2026" },
        ),
      );
      expect(speakerInviteResponse.status).toBe(200);
      const speakerInvitePayload = (await speakerInviteResponse.json()) as { created: Array<{ inviteToken: string }> };
      const speakerInviteToken = speakerInvitePayload.created[0].inviteToken;

      const proposalResponse = await submitProposal(
        createContext(
          env,
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
          { eventSlug: "pqc-2026" },
        ),
      );
      expect(proposalResponse.status).toBe(200);
      const createdProposal = (await proposalResponse.json()) as ProposalPayload;

      const reviewOneResponse = await addProposalReview(
        createContext(
          env,
          new Request(`https://app.test/api/v1/admin/proposals/${createdProposal.proposalId}/reviews`, {
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
          { proposalId: createdProposal.proposalId },
        ),
      );
      expect(reviewOneResponse.status).toBe(200);

      const reviewTwoResponse = await addProposalReview(
        createContext(
          env,
          new Request(`https://app.test/api/v1/admin/proposals/${createdProposal.proposalId}/reviews`, {
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
          { proposalId: createdProposal.proposalId },
        ),
      );
      expect(reviewTwoResponse.status).toBe(200);

      const finalizeResponse = await finalizeProposal(
        createContext(
          env,
          new Request(`https://app.test/api/v1/admin/proposals/${createdProposal.proposalId}/finalize`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: adminSessionCookie,
            },
            body: JSON.stringify({
              finalStatus: "accepted",
              decisionNote: "Approved by committee",
              minReviewsRequired: 2,
            }),
          }),
          { proposalId: createdProposal.proposalId },
        ),
      );
      expect(finalizeResponse.status).toBe(200);

      const registrationOneResponse = await createRegistration(
        createContext(
          env,
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
          { eventSlug: "pqc-2026" },
        ),
      );
      const registrationOnePayload = (await registrationOneResponse.json()) as CreateRegistrationPayload;
      expect(registrationOnePayload.status).toBe("pending_email_confirmation");

      const firstConfirmationPayload = (
        await queryAll<{ payload_json: string }>(
          env.DB,
          "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' AND recipient_email = 'attendee1@pkic.org' ORDER BY created_at DESC LIMIT 1",
        )
      )[0];
      const firstConfirmationToken = extractTokenFromOutboxUrl(
        firstConfirmationPayload.payload_json,
        "confirmationUrl",
      );

      const firstConfirmResponse = await confirmRegistrationEmail(
        createContext(
          env,
          new Request(
            `https://app.test/api/v1/events/pqc-2026/registrations/confirm-email?token=${encodeURIComponent(
              firstConfirmationToken,
            )}`,
            { method: "GET" },
          ),
          { eventSlug: "pqc-2026" },
        ),
      );
      const firstConfirmPayload = (await firstConfirmResponse.json()) as { status: string; manageToken: string };
      expect(firstConfirmPayload.status).toBe("registered");

      const inviteFromAttendeeResponse = await inviteAttendeesFromRegistration(
        createContext(
          env,
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
          { eventSlug: "pqc-2026" },
        ),
      );
      expect(inviteFromAttendeeResponse.status).toBe(200);
      const inviteFromAttendeePayload = (await inviteFromAttendeeResponse.json()) as { referralCode: string };
      expect(inviteFromAttendeePayload.referralCode).toHaveLength(7);

      const registrationTwoResponse = await createRegistration(
        createContext(
          env,
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
          { eventSlug: "pqc-2026" },
        ),
      );
      const registrationTwoPayload = (await registrationTwoResponse.json()) as CreateRegistrationPayload;

      const secondConfirmationPayload = (
        await queryAll<{ payload_json: string }>(
          env.DB,
          "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' AND recipient_email = 'attendee2@pkic.org' ORDER BY created_at DESC LIMIT 1",
        )
      )[0];
      const secondConfirmationToken = extractTokenFromOutboxUrl(
        secondConfirmationPayload.payload_json,
        "confirmationUrl",
      );

      const secondConfirmResponse = await confirmRegistrationEmail(
        createContext(
          env,
          new Request(
            `https://app.test/api/v1/events/pqc-2026/registrations/confirm-email?token=${encodeURIComponent(
              secondConfirmationToken,
            )}`,
            { method: "GET" },
          ),
          { eventSlug: "pqc-2026" },
        ),
      );
      const secondConfirmPayload = (await secondConfirmResponse.json()) as { status: string };
      expect(secondConfirmPayload.status).toBe("waitlisted");

      const cancelRegistrationResponse = await manageRegistration(
        createContext(
          env,
          new Request(`https://app.test/api/v1/registrations/manage/${firstConfirmPayload.manageToken}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "cancel" }),
          }),
          { token: firstConfirmPayload.manageToken },
        ),
      );
      expect(cancelRegistrationResponse.status).toBe(200);

      const waitlistStatus = (
        await queryAll<{ status: string }>(env.DB, "SELECT status FROM waitlist_entries WHERE registration_id = ?", [
          registrationTwoPayload.registrationId,
        ])
      )[0];
      expect(waitlistStatus.status).toBe("waiting");

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

      const retryResponse = await retryPendingEmail(
        createContext(
          env,
          new Request("https://app.test/api/v1/internal/email/retry", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${adminSessionToken}`,
            },
            body: JSON.stringify({ limit: 50 }),
          }),
          {},
        ),
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
