/**
 * api-security.test.ts
 *
 * Integration-level security test that verifies:
 *
 *  1. Every protected admin / internal endpoint enforces authentication and
 *     rejects unauthenticated requests with AUTH_REQUIRED.
 *
 *  2. The session-token validation logic handles all invalid-credential
 *     scenarios (garbage token, expired session, revoked session, non-admin
 *     user, inactive admin user) and also accepts the ADMIN_API_KEY shortcut.
 *
 *  3. Endpoints reject unsupported HTTP methods with 405.
 *
 *  4. Public endpoints remain accessible without any credentials.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { nowIso } from "../functions/_lib/utils/time";
import type { PagesContext } from "../functions/_lib/types";

// ── Admin endpoint handlers ───────────────────────────────────────────────────
import { onRequestGet as adminUsersGet, onRequest as adminUsersRequest } from "../functions/api/v1/admin/users";
import { onRequestGet as adminStatsGet, onRequest as adminStatsRequest } from "../functions/api/v1/admin/stats";
import { onRequestGet as adminDonationsGet } from "../functions/api/v1/admin/donations";
import { onRequestGet as adminEmailTemplatesGet, onRequest as adminEmailTemplatesRequest } from "../functions/api/v1/admin/email-templates";
import { onRequestGet as adminEventsGet } from "../functions/api/v1/admin/events";
// Event-scoped admin endpoints (require eventSlug param)
import { onRequestGet as adminEventRegistrationsGet } from "../functions/api/v1/admin/events/[eventSlug]/registrations";
import { onRequestGet as adminEventInvitesGet } from "../functions/api/v1/admin/events/[eventSlug]/invites/index";
import { onRequestGet as adminEventFormsGet } from "../functions/api/v1/admin/events/[eventSlug]/forms";
// User-scoped admin endpoint (requires userId param)
import { onRequestGet as adminUserByIdGet, onRequestPatch as adminUserByIdPatch } from "../functions/api/v1/admin/users/[userId]/index";
// Internal endpoints
import { onRequestPost as internalEmailRetryPost, onRequest as internalEmailRetryRequest } from "../functions/api/v1/internal/email/retry";
import { onRequestPost as internalJobsPost, onRequest as internalJobsRequest } from "../functions/api/v1/internal/jobs/run";
import { onRequestPost as internalRemindersPost } from "../functions/api/v1/internal/reminders/run";
import { onRequestPost as internalRetentionPost } from "../functions/api/v1/internal/retention/run";
import { onRequestPost as internalEmailResetPost, onRequest as internalEmailResetRequest } from "../functions/api/v1/internal/email/reset-failed";
// Additional admin endpoints not in the original coverage
import { onRequestPost as adminEventsPost } from "../functions/api/v1/admin/events";
import { onRequestPost as adminDonationsSyncPost } from "../functions/api/v1/admin/donations/sync";
import { onRequestPost as adminEmailTemplatesPreviewPost } from "../functions/api/v1/admin/email-templates/preview";
import { onRequestPost as adminEmailTemplatesActivatePost } from "../functions/api/v1/admin/email-templates/[key]/activate";
import { onRequestPost as adminEmailTemplatesVersionsPost } from "../functions/api/v1/admin/email-templates/[key]/versions";
import { onRequestGet as adminFormGet, onRequestPatch as adminFormPatch, onRequestDelete as adminFormDelete } from "../functions/api/v1/admin/forms/[formKey]/index";
import { onRequestGet as adminFormSubmissionsGet } from "../functions/api/v1/admin/forms/[formKey]/submissions";
import { onRequestPatch as adminUserPatch } from "../functions/api/v1/admin/users/[userId]";
import { onRequestPost as adminUserAnonymizePost } from "../functions/api/v1/admin/users/[userId]/anonymize";
import { onRequestPost as adminUserGravatarPost } from "../functions/api/v1/admin/users/[userId]/gravatar";
import { onRequest as adminUserHeadshotRequest } from "../functions/api/v1/admin/users/[userId]/headshot";
import { onRequestPost as adminEventsSyncPost } from "../functions/api/v1/admin/events/sync-from-hugo";
import { onRequestGet as adminEventGet } from "../functions/api/v1/admin/events/[eventSlug]/index";
import { onRequestGet as adminEventDaysGet } from "../functions/api/v1/admin/events/[eventSlug]/days";
import { onRequestPost as adminEventFormsPost } from "../functions/api/v1/admin/events/[eventSlug]/forms";
import { onRequestPatch as adminEventSettingsPatch } from "../functions/api/v1/admin/events/[eventSlug]/settings";
import { onRequestGet as adminEventTermsGet } from "../functions/api/v1/admin/events/[eventSlug]/terms";
import { onRequestGet as adminEventPermissionsGet, onRequestPost as adminEventPermissionsPost } from "../functions/api/v1/admin/events/[eventSlug]/permissions";
import { onRequestDelete as adminEventPermissionDelete } from "../functions/api/v1/admin/events/[eventSlug]/permissions/[permId]";
import { onRequestGet as adminEventPromotersGet } from "../functions/api/v1/admin/events/[eventSlug]/promoters";
import { onRequestGet as adminEventProposalsGet } from "../functions/api/v1/admin/events/[eventSlug]/proposals";
import { onRequestPost as adminEmailCampaignPreviewPost } from "../functions/api/v1/admin/events/[eventSlug]/emails/campaign/preview";
import { onRequestPost as adminEmailCampaignSendPost } from "../functions/api/v1/admin/events/[eventSlug]/emails/campaign/send";
import { onRequestPost as adminInviteResendPost } from "../functions/api/v1/admin/events/[eventSlug]/invites/[inviteId]/resend";
import { onRequestPost as adminInviteAttendeesBulkPost } from "../functions/api/v1/admin/events/[eventSlug]/invites/attendees/bulk";
import { onRequestPost as adminInviteAttendeesPreviewPost } from "../functions/api/v1/admin/events/[eventSlug]/invites/attendees/preview";
import { onRequestPost as adminInviteSpeakersBulkPost } from "../functions/api/v1/admin/events/[eventSlug]/invites/speakers/bulk";
import { onRequestPost as adminRegistrationAdmitPost } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/admit";
import { onRequestGet as adminRegistrationBadgeRoleGet } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/badge-role";
import { onRequestGet as adminRegistrationGet } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/index";
import { onRequestPost as adminRegistrationOpenManagePost } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/open-manage";
import { onRequestPost as adminRegistrationRegenerateBadgePost } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/regenerate-badge";
import { onRequestPost as adminRegistrationResendConfirmPost } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/resend-confirmation";
import { onRequestPost as adminProposalFinalizePost } from "../functions/api/v1/admin/proposals/[proposalId]/finalize";
import { onRequestGet as adminProposalReviewsGet, onRequestPost as adminProposalReviewsPost } from "../functions/api/v1/admin/proposals/[proposalId]/reviews";
import { onRequestGet as adminProposalSpeakersGet } from "../functions/api/v1/admin/proposals/[proposalId]/speakers";
import { onRequestPatch as adminProposalReviewPatch } from "../functions/api/v1/admin/proposals/[proposalId]/reviews/[reviewId]";

// ── Public endpoint handlers ──────────────────────────────────────────────────
import { onRequestGet as eventTermsGet } from "../functions/api/v1/events/[eventSlug]/terms";
import { onRequestGet as eventFormsGet, onRequest as eventFormsRequest } from "../functions/api/v1/events/[eventSlug]/forms";
import { onRequest as geoRequest } from "../functions/api/v1/geo";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Makes a GET request with no Authorization header. */
function anonGet(url: string): Request {
  return new Request(url);
}

/** Makes a POST request with no Authorization header. */
function anonPost(url: string): Request {
  return new Request(url, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
}

/** Makes a GET request with a Bearer token. */
function bearerGet(url: string, token: string): Request {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

/** Makes a PATCH request with no Authorization header. */
function anonPatch(url: string): Request {
  return new Request(url, { method: "PATCH", body: "{}", headers: { "content-type": "application/json" } });
}

/** Makes a DELETE request with no Authorization header. */
function anonDelete(url: string): Request {
  return new Request(url, { method: "DELETE" });
}

/** Inserts a session directly, allowing control over expires_at and revoked_at. */
async function insertSession(
  db: D1DatabaseShim,
  userId: string,
  rawToken: string,
  opts: { expiresAt?: string; revokedAt?: string } = {},
): Promise<void> {
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  const revokedAt = opts.revokedAt ?? null;
  await db.exec?.(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
    VALUES ('${crypto.randomUUID()}', '${userId}', '${tokenHash}',
            '${expiresAt}', ${revokedAt ? `'${revokedAt}'` : "NULL"}, '${nowIso()}');
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Admin / internal endpoint — auth enforcement (no Authorization header)
// ─────────────────────────────────────────────────────────────────────────────

describe("protected endpoint — rejects unauthenticated requests", () => {
  let db: D1DatabaseShim;
  let env: ReturnType<typeof createEnv>;
  let eventSlug: string;
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const inviteId = crypto.randomUUID();
  const permId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const formKey = "test-form";
  const templateKey = "transactional";
  const reviewId = crypto.randomUUID();

  beforeEach(async () => {
    db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    env = createEnv(db);
    eventSlug = "pqc-2026";
  });

  // Each entry: [description, thunk that invokes the handler with no auth]
  const cases: [string, () => Promise<Response>][] = [
    [
      "GET /api/v1/admin/users",
      () => adminUsersGet(createContext(env, anonGet("https://app.test/api/v1/admin/users"), {})),
    ],
    [
      "GET /api/v1/admin/stats",
      () => adminStatsGet(createContext(env, anonGet("https://app.test/api/v1/admin/stats"), {})),
    ],
    [
      "GET /api/v1/admin/donations",
      () => adminDonationsGet(createContext(env, anonGet("https://app.test/api/v1/admin/donations"), {})),
    ],
    [
      "GET /api/v1/admin/email-templates",
      () => adminEmailTemplatesGet(createContext(env, anonGet("https://app.test/api/v1/admin/email-templates"), {})),
    ],
    [
      "GET /api/v1/admin/events",
      () => adminEventsGet(createContext(env, anonGet("https://app.test/api/v1/admin/events"), {})),
    ],
    [
      "GET /api/v1/admin/events/:slug/registrations",
      () =>
        adminEventRegistrationsGet(
          createContext(
            env,
            anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/registrations`),
            { eventSlug },
          ),
        ),
    ],
    [
      "GET /api/v1/admin/events/:slug/invites",
      () =>
        adminEventInvitesGet(
          createContext(
            env,
            anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/invites`),
            { eventSlug },
          ),
        ),
    ],
    [
      "GET /api/v1/admin/events/:slug/forms",
      () =>
        adminEventFormsGet(
          createContext(
            env,
            anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/forms`),
            { eventSlug },
          ),
        ),
    ],
    [
      "GET /api/v1/admin/users/:id",
      () =>
        adminUserByIdGet(
          createContext(
            env,
            anonGet(`https://app.test/api/v1/admin/users/${userId}`),
            { userId },
          ),
        ),
    ],
    [
      "POST /api/v1/internal/email/retry",
      () => internalEmailRetryPost(createContext(env, anonPost("https://app.test/api/v1/internal/email/retry"), {})),
    ],
    [
      "POST /api/v1/internal/jobs/run",
      () => internalJobsPost(createContext(env, anonPost("https://app.test/api/v1/internal/jobs/run"), {})),
    ],
    [
      "POST /api/v1/internal/reminders/run",
      () => internalRemindersPost(createContext(env, anonPost("https://app.test/api/v1/internal/reminders/run"), {})),
    ],
    [
      "POST /api/v1/internal/retention/run",
      () => internalRetentionPost(createContext(env, anonPost("https://app.test/api/v1/internal/retention/run"), {})),
    ],
    [
      "POST /api/v1/internal/email/reset-failed",
      () => internalEmailResetPost(createContext(env, anonPost("https://app.test/api/v1/internal/email/reset-failed"), {})),
    ],
    // ── Additional admin endpoints ──────────────────────────────────────────
    [
      "POST /api/v1/admin/events",
      () => adminEventsPost(createContext(env, anonPost("https://app.test/api/v1/admin/events"), {})),
    ],
    [
      "POST /api/v1/admin/donations/sync",
      () => adminDonationsSyncPost(createContext(env, anonPost("https://app.test/api/v1/admin/donations/sync"), {})),
    ],
    [
      "POST /api/v1/admin/email-templates/preview",
      () => adminEmailTemplatesPreviewPost(createContext(env, anonPost("https://app.test/api/v1/admin/email-templates/preview"), {})),
    ],
    [
      "POST /api/v1/admin/email-templates/:key/activate",
      () => adminEmailTemplatesActivatePost(createContext(env, anonPost(`https://app.test/api/v1/admin/email-templates/${templateKey}/activate`), { key: templateKey })),
    ],
    [
      "POST /api/v1/admin/email-templates/:key/versions",
      () => adminEmailTemplatesVersionsPost(createContext(env, anonPost(`https://app.test/api/v1/admin/email-templates/${templateKey}/versions`), { key: templateKey })),
    ],
    [
      "GET /api/v1/admin/forms/:formKey",
      () => adminFormGet(createContext(env, anonGet(`https://app.test/api/v1/admin/forms/${formKey}`), { formKey })),
    ],
    [
      "PATCH /api/v1/admin/forms/:formKey",
      () => adminFormPatch(createContext(env, anonPatch(`https://app.test/api/v1/admin/forms/${formKey}`), { formKey })),
    ],
    [
      "DELETE /api/v1/admin/forms/:formKey",
      () => adminFormDelete(createContext(env, anonDelete(`https://app.test/api/v1/admin/forms/${formKey}`), { formKey })),
    ],
    [
      "GET /api/v1/admin/forms/:formKey/submissions",
      () => adminFormSubmissionsGet(createContext(env, anonGet(`https://app.test/api/v1/admin/forms/${formKey}/submissions`), { formKey })),
    ],
    [
      "PATCH /api/v1/admin/users/:userId (global role)",
      () => adminUserPatch(createContext(env, anonPatch(`https://app.test/api/v1/admin/users/${userId}`), { userId })),
    ],
    [
      "PATCH /api/v1/admin/users/:userId (detail+role)",
      () => adminUserByIdPatch(createContext(env, anonPatch(`https://app.test/api/v1/admin/users/${userId}`), { userId })),
    ],
    [
      "POST /api/v1/admin/users/:userId/anonymize",
      () => adminUserAnonymizePost(createContext(env, anonPost(`https://app.test/api/v1/admin/users/${userId}/anonymize`), { userId })),
    ],
    [
      "POST /api/v1/admin/users/:userId/gravatar",
      () => adminUserGravatarPost(createContext(env, anonPost(`https://app.test/api/v1/admin/users/${userId}/gravatar`), { userId })),
    ],
    [
      "* /api/v1/admin/users/:userId/headshot",
      () => adminUserHeadshotRequest(createContext(env, anonGet(`https://app.test/api/v1/admin/users/${userId}/headshot`), { userId })),
    ],
    [
      "POST /api/v1/admin/events/sync-from-hugo",
      () => adminEventsSyncPost(createContext(env, anonPost("https://app.test/api/v1/admin/events/sync-from-hugo"), {})),
    ],
    [
      "GET /api/v1/admin/events/:slug (detail)",
      () => adminEventGet(createContext(env, anonGet(`https://app.test/api/v1/admin/events/${eventSlug}`), { eventSlug })),
    ],
    [
      "GET /api/v1/admin/events/:slug/days",
      () => adminEventDaysGet(createContext(env, anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/days`), { eventSlug })),
    ],
    [
      "POST /api/v1/admin/events/:slug/forms",
      () => adminEventFormsPost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/forms`), { eventSlug })),
    ],
    [
      "PATCH /api/v1/admin/events/:slug/settings",
      () => adminEventSettingsPatch(createContext(env, anonPatch(`https://app.test/api/v1/admin/events/${eventSlug}/settings`), { eventSlug })),
    ],
    [
      "GET /api/v1/admin/events/:slug/terms",
      () => adminEventTermsGet(createContext(env, anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/terms`), { eventSlug })),
    ],
    [
      "GET /api/v1/admin/events/:slug/permissions",
      () => adminEventPermissionsGet(createContext(env, anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/permissions`), { eventSlug })),
    ],
    [
      "POST /api/v1/admin/events/:slug/permissions",
      () => adminEventPermissionsPost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/permissions`), { eventSlug })),
    ],
    [
      "DELETE /api/v1/admin/events/:slug/permissions/:permId",
      () => adminEventPermissionDelete(createContext(env, anonDelete(`https://app.test/api/v1/admin/events/${eventSlug}/permissions/${permId}`), { eventSlug, permId })),
    ],
    [
      "GET /api/v1/admin/events/:slug/promoters",
      () => adminEventPromotersGet(createContext(env, anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/promoters`), { eventSlug })),
    ],
    [
      "GET /api/v1/admin/events/:slug/proposals",
      () => adminEventProposalsGet(createContext(env, anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/proposals`), { eventSlug })),
    ],
    [
      "POST /api/v1/admin/events/:slug/emails/campaign/preview",
      () => adminEmailCampaignPreviewPost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/emails/campaign/preview`), { eventSlug })),
    ],
    [
      "POST /api/v1/admin/events/:slug/emails/campaign/send",
      () => adminEmailCampaignSendPost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/emails/campaign/send`), { eventSlug })),
    ],
    [
      "POST /api/v1/admin/events/:slug/invites/:inviteId/resend",
      () => adminInviteResendPost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/invites/${inviteId}/resend`), { eventSlug, inviteId })),
    ],
    [
      "POST /api/v1/admin/events/:slug/invites/attendees/bulk",
      () => adminInviteAttendeesBulkPost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/invites/attendees/bulk`), { eventSlug })),
    ],
    [
      "POST /api/v1/admin/events/:slug/invites/attendees/preview",
      () => adminInviteAttendeesPreviewPost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/invites/attendees/preview`), { eventSlug })),
    ],
    [
      "POST /api/v1/admin/events/:slug/invites/speakers/bulk",
      () => adminInviteSpeakersBulkPost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/invites/speakers/bulk`), { eventSlug })),
    ],
    [
      "POST /api/v1/admin/events/:slug/registrations/:registrationId/admit",
      () => adminRegistrationAdmitPost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/admit`), { eventSlug, registrationId })),
    ],
    [
      "GET /api/v1/admin/events/:slug/registrations/:registrationId/badge-role",
      () => adminRegistrationBadgeRoleGet(createContext(env, anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/badge-role`), { eventSlug, registrationId })),
    ],
    [
      "GET /api/v1/admin/events/:slug/registrations/:registrationId",
      () => adminRegistrationGet(createContext(env, anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}`), { eventSlug, registrationId })),
    ],
    [
      "POST /api/v1/admin/events/:slug/registrations/:registrationId/open-manage",
      () => adminRegistrationOpenManagePost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/open-manage`), { eventSlug, registrationId })),
    ],
    [
      "POST /api/v1/admin/events/:slug/registrations/:registrationId/regenerate-badge",
      () => adminRegistrationRegenerateBadgePost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/regenerate-badge`), { eventSlug, registrationId })),
    ],
    [
      "POST /api/v1/admin/events/:slug/registrations/:registrationId/resend-confirmation",
      () => adminRegistrationResendConfirmPost(createContext(env, anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/resend-confirmation`), { eventSlug, registrationId })),
    ],
    [
      "POST /api/v1/admin/proposals/:proposalId/finalize",
      () => adminProposalFinalizePost(createContext(env, anonPost(`https://app.test/api/v1/admin/proposals/${proposalId}/finalize`), { proposalId })),
    ],
    [
      "GET /api/v1/admin/proposals/:proposalId/reviews",
      () => adminProposalReviewsGet(createContext(env, anonGet(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`), { proposalId })),
    ],
    [
      "POST /api/v1/admin/proposals/:proposalId/reviews",
      () => adminProposalReviewsPost(createContext(env, anonPost(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`), { proposalId })),
    ],
    [
      "PATCH /api/v1/admin/proposals/:proposalId/reviews/:reviewId",
      () => adminProposalReviewPatch(createContext(env, anonPatch(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews/${reviewId}`), { proposalId, reviewId })),
    ],
    [
      "GET /api/v1/admin/proposals/:proposalId/speakers",
      () => adminProposalSpeakersGet(createContext(env, anonGet(`https://app.test/api/v1/admin/proposals/${proposalId}/speakers`), { proposalId })),
    ],
  ];

  for (const [label, invoke] of cases) {
    it(`rejects ${label} with no Authorization header → AUTH_REQUIRED`, async () => {
      await expect(invoke()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Session-token validation — all rejection modes + API key acceptance
// (tested via GET /api/v1/admin/users as the representative endpoint)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-token validation", () => {
  let db: D1DatabaseShim;
  let env: ReturnType<typeof createEnv>;
  let adminId: string;

  beforeEach(async () => {
    db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    env = createEnv(db);
    // Retrieve the admin user id that seedEventAndAdmin created
    const row = db.raw<{ id: string }>("SELECT id FROM users WHERE role = 'admin' LIMIT 1")[0];
    adminId = row.id;
  });

  function callUsers(token: string): Promise<Response> {
    return adminUsersGet(
      createContext(env, bearerGet("https://app.test/api/v1/admin/users", token), {}),
    );
  }

  it("rejects a garbage / non-existent token → AUTH_INVALID", async () => {
    await expect(callUsers("totally-invalid-token")).rejects.toMatchObject({ code: "AUTH_INVALID" });
  });

  it("rejects a well-formed but wrong token → AUTH_INVALID", async () => {
    // Create a session with known token, then query with a different one
    await createAdminSession(db, adminId, "real-token");
    await expect(callUsers("wrong-token")).rejects.toMatchObject({ code: "AUTH_INVALID" });
  });

  it("rejects an expired session → AUTH_EXPIRED", async () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString(); // 1 s in the past
    await insertSession(db, adminId, "expired-token", { expiresAt: expiredAt });
    await expect(callUsers("expired-token")).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });

  it("rejects a revoked session → AUTH_REVOKED", async () => {
    await insertSession(db, adminId, "revoked-token", { revokedAt: nowIso() });
    await expect(callUsers("revoked-token")).rejects.toMatchObject({ code: "AUTH_REVOKED" });
  });

  it("rejects a token belonging to a non-admin user (role='user') → AUTH_INVALID", async () => {
    const regularUserId = crypto.randomUUID();
    await db.exec?.(`
      INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
      VALUES ('${regularUserId}', 'regular@example.test', 'regular@example.test',
              'user', 1, datetime('now'), datetime('now'));
    `);
    await insertSession(db, regularUserId, "user-token");
    // A regular user's session must not grant admin access
    await expect(callUsers("user-token")).rejects.toMatchObject({ code: "AUTH_INVALID" });
  });

  it("rejects a token belonging to an inactive admin (active=0) → AUTH_INVALID", async () => {
    const inactiveAdminId = crypto.randomUUID();
    await db.exec?.(`
      INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
      VALUES ('${inactiveAdminId}', 'inactive@example.test', 'inactive@example.test',
              'admin', 0, datetime('now'), datetime('now'));
    `);
    await insertSession(db, inactiveAdminId, "inactive-admin-token");
    await expect(callUsers("inactive-admin-token")).rejects.toMatchObject({ code: "AUTH_INVALID" });
  });

  it("accepts a valid ADMIN_API_KEY as a bearer token", async () => {
    const envWithKey = { ...env, ADMIN_API_KEY: "super-secret-api-key" };
    const response = await adminUsersGet(
      createContext(
        envWithKey,
        bearerGet("https://app.test/api/v1/admin/users", "super-secret-api-key"),
        {},
      ),
    );
    expect(response.status).toBe(200);
  });

  it("accepts a valid active admin session token", async () => {
    await createAdminSession(db, adminId, "valid-admin-token");
    const response = await callUsers("valid-admin-token");
    expect(response.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. HTTP method enforcement (405 Method Not Allowed)
// ─────────────────────────────────────────────────────────────────────────────

describe("HTTP method enforcement", () => {
  let db: D1DatabaseShim;
  let env: ReturnType<typeof createEnv>;

  beforeEach(async () => {
    db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    env = createEnv(db);
  });

  it("rejects POST to GET-only /api/v1/admin/users → 405", async () => {
    const response = await adminUsersRequest(
      createContext(env, new Request("https://app.test/api/v1/admin/users", { method: "POST" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects POST to GET-only /api/v1/admin/stats → 405", async () => {
    const response = await adminStatsRequest(
      createContext(env, new Request("https://app.test/api/v1/admin/stats", { method: "POST" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects POST to GET-only /api/v1/admin/email-templates → 405", async () => {
    const response = await adminEmailTemplatesRequest(
      createContext(env, new Request("https://app.test/api/v1/admin/email-templates", { method: "POST" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects GET to POST-only /api/v1/internal/email/retry → 405", async () => {
    const response = await internalEmailRetryRequest(
      createContext(env, new Request("https://app.test/api/v1/internal/email/retry", { method: "GET" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects GET to POST-only /api/v1/internal/jobs/run → 405", async () => {
    const response = await internalJobsRequest(
      createContext(env, new Request("https://app.test/api/v1/internal/jobs/run", { method: "GET" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects GET to POST-only /api/v1/internal/email/reset-failed → 405", async () => {
    const response = await internalEmailResetRequest(
      createContext(env, new Request("https://app.test/api/v1/internal/email/reset-failed", { method: "GET" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects POST to GET-only /api/v1/events/:slug/forms → 405", async () => {
    const response = await eventFormsRequest(
      createContext(env, new Request("https://app.test/api/v1/events/pqc-2026/forms", { method: "POST" }), { eventSlug: "pqc-2026" }),
    );
    expect(response.status).toBe(405);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Public endpoints — accessible without any credentials
// ─────────────────────────────────────────────────────────────────────────────

describe("public endpoints — accessible without credentials", () => {
  let db: D1DatabaseShim;
  let env: ReturnType<typeof createEnv>;

  beforeEach(async () => {
    db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    env = createEnv(db);
  });

  it("GET /api/v1/events/:slug/terms returns 200 without Authorization header", async () => {
    const response = await eventTermsGet(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/terms"),
        { eventSlug: "pqc-2026" },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { terms: unknown[] };
    expect(Array.isArray(body.terms)).toBe(true);
  });

  it("GET /api/v1/geo returns 200 for a same-origin request without Authorization header", async () => {
    const response = await geoRequest(
      createContext(
        env,
        new Request("https://app.test/api/v1/geo", {
          headers: { "sec-fetch-site": "same-origin" },
        }),
        {},
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { country: string | null };
    expect("country" in body).toBe(true);
  });

  it("GET /api/v1/geo rejects cross-origin requests (CSRF guard) without any credentials needed", async () => {
    const response = await geoRequest(
      createContext(
        env,
        new Request("https://evil.example.com/steal", {
          headers: {
            "sec-fetch-site": "cross-site",
            origin: "https://evil.example.com",
          },
        }),
        {},
      ),
    );
    expect(response.status).toBe(403);
  });

  it("GET /api/v1/events/:slug/forms returns 200 without Authorization header", async () => {
    const response = await eventFormsGet(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/forms"),
        { eventSlug: "pqc-2026" },
      ),
    );
    expect(response.status).toBe(200);
  });
});
