import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ALLOWED_PRESENTATION_MIME_TYPES } from "../assets/shared/presentation-upload";
import { registrationConfirmResponseSchema } from "../assets/shared/schemas/registration";
import { AUTH_EXTENSION, decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { openapi } from "../functions/router";

describe("OpenAPI schema generation", () => {
  it("generates the full API document", () => {
    expect(() => openapi.schema).not.toThrow();
  });

  it("documents public registration and speaker capability workflows through shared contracts", () => {
    const spec = decorateOpenApiSpec(openapi.schema);

    expect(spec.paths["/api/v1/events/{eventSlug}/proposals"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/proposals"].get).toBeDefined();
    expect(spec.paths["/api/v1/groups/{groupId}/events/{eventId}/proposals"].get).toBeDefined();
    expect(spec.paths["/api/v1/groups/{groupId}/events/{eventId}/proposals/{proposalId}"]).toBeUndefined();
    expect(spec.paths["/api/v1/proposals/programs"].get).toBeDefined();
    expect(spec.paths["/api/v1/proposals/{proposalId}/speakers"].post).toBeDefined();
    expect(spec.paths["/api/v1/me/proposal-programs"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/proposals"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/confirm-email"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/confirm-email"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/confirm-info"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/resend-confirmation"].post).toBeDefined();
    expect(spec.paths["/api/v1/registrations/access/{token}"].get).toBeDefined();
    expect(spec.paths["/api/v1/registrations/access/{token}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/registrations/manage/{token}"]).toBeUndefined();
    expect(spec.paths["/api/v1/proposals/access/{token}"].get).toBeDefined();
    expect(spec.paths["/api/v1/proposals/access/{token}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/proposals/access/{token}/speakers"].post).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}"].get).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}"].post).toBeUndefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}"].patch).toBeUndefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}/participation"].patch).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}/profile"].patch).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}/headshot"].get).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}/headshot"].put).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}/headshot"].delete).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}/presentation"].get).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}/presentation"].put).toBeDefined();
    const presentationContent =
      spec.paths["/api/v1/proposals/speakers/access/{token}/presentation"].get.responses["200"].content;
    for (const mimeType of ALLOWED_PRESENTATION_MIME_TYPES) {
      expect(presentationContent[mimeType]).toBeDefined();
    }
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}/reminder-preferences"].patch).toBeDefined();
    expect(spec.paths["/api/v1/proposals/access/{token}/speakers/{userId}/reminders"].post).toBeDefined();
    expect(spec.paths["/api/v1/proposals/access/{token}/speakers/{userId}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/proposals/manage/{token}"]).toBeUndefined();
    expect(spec.paths["/api/v1/proposals/speaker/{token}"]).toBeUndefined();
    expect(spec.paths["/api/v1/proposals/access/{token}/speakers/reminders"]).toBeUndefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}/reminders"]).toBeUndefined();
    expect(spec.paths["/api/v1/proposals/speakers/access/{token}/presentation/download"]).toBeUndefined();
    expect(spec.paths["/api/v1/forms"].get).toBeDefined();
    expect(spec.paths["/api/v1/forms"].post).toBeDefined();
    expect(spec.paths["/api/v1/members/applications"].post).toBeDefined();
    expect(spec.paths["/api/v1/members/applications"].get).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/form"].get).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/form/definition"].get).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/form/definition"].patch).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/{id}"].get).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/{id}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/{id}/documents"].get).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/{id}/documents"].post).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/{id}/stage"].patch).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/{id}/communications"].post).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/{id}/notes"].post).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/{id}/ec-decisions"].post).toBeDefined();
    expect(spec.paths["/api/v1/members/applications/{id}/approve"].post).toBeDefined();
    expect(spec.paths["/api/v1/system/membership-applications"]).toBeUndefined();
    expect(spec.paths["/api/v1/system/membership-applications/{id}"]).toBeUndefined();
    expect(spec.paths["/api/v1/system/membership-applications/{id}/documents"]).toBeUndefined();
    expect(spec.paths["/api/v1/sponsors/inquiries"].post).toBeDefined();
  });

  it("mounts management contracts through their owning resource routers", () => {
    const spec = decorateOpenApiSpec(openapi.schema);

    expect(Object.keys(spec.paths).some((path) => path.startsWith("/api/v1/admin"))).toBe(false);

    expect(spec.paths["/api/v1/scheduler/jobs"].get).toBeDefined();
    expect(spec.paths["/api/v1/scheduler/jobs/{jobKey}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/scheduler/jobs/{jobKey}/runs"].post).toBeDefined();
    expect(spec.paths["/api/v1/scheduler/jobs/{jobKey}/pause"]).toBeUndefined();
    expect(spec.paths["/api/v1/scheduler/jobs/{jobKey}/resume"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/imports"].post).toBeDefined();
    // The ownerless admin event collection and its Hugo sync route are retired.
    expect(spec.paths["/api/v1/admin/events"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/sync-from-hugo"]).toBeUndefined();
    expect(spec.paths["/api/v1/email/templates"].get).toBeDefined();
    expect(spec.paths["/api/v1/email/templates/preview"].post).toBeDefined();
    expect(spec.paths["/api/v1/email/templates/{key}/versions"].get).toBeDefined();
    expect(spec.paths["/api/v1/email/templates/{key}/versions"].post).toBeDefined();
    expect(spec.paths["/api/v1/email/templates/{key}/activate"].post).toBeDefined();
    expect(spec.paths["/api/v1/email/templates/{key}/exists"].get).toBeDefined();
    expect(spec.paths["/api/v1/system/email-templates"]).toBeUndefined();
    expect(spec.paths["/api/v1/system/email-templates/preview"]).toBeUndefined();
    expect(spec.paths["/api/v1/system/email-templates/{key}/versions"]).toBeUndefined();
    expect(spec.paths["/api/v1/system/email-templates/{key}/activate"]).toBeUndefined();
    expect(spec.paths["/api/v1/system/email-templates/{key}/exists"]).toBeUndefined();
    expect(spec.paths["/api/v1/permissions/grants"].get).toBeDefined();
    expect(spec.paths["/api/v1/permissions/grants"].post).toBeDefined();
    expect(spec.paths["/api/v1/permissions/subjects"].get).toBeDefined();
    expect(spec.paths["/api/v1/permissions/targets"].get).toBeDefined();
    expect(spec.paths["/api/v1/roles"].get).toBeDefined();
    expect(spec.paths["/api/v1/users/{userId}/roles"].get).toBeDefined();
    expect(spec.paths["/api/v1/system/access-control/grants"]).toBeUndefined();
    expect(spec.paths["/api/v1/leadership/positions"].get).toBeDefined();
    expect(spec.paths["/api/v1/leadership/positions"].post).toBeDefined();
    expect(spec.paths["/api/v1/leadership/positions/{id}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/leadership/positions/{id}"].delete).toBeDefined();
    expect(spec.paths["/api/v1/leadership/positions/users/{userId}/affiliations"].get).toBeDefined();
    expect(spec.paths["/api/v1/system/leadership-positions"]).toBeUndefined();
    expect(spec.paths["/api/v1/system/leadership-positions/{id}"]).toBeUndefined();
    expect(spec.paths["/api/v1/analytics/summary"].get).toBeDefined();
    expect(spec.paths["/api/v1/analytics/registrations"].get).toBeDefined();
    expect(spec.paths["/api/v1/analytics/donations"].get).toBeDefined();
    expect(spec.paths["/api/v1/system/analytics/summary"]).toBeUndefined();
    expect(spec.paths["/api/v1/system/analytics/registrations"]).toBeUndefined();
    expect(spec.paths["/api/v1/system/analytics/donations"]).toBeUndefined();
    expect(spec.paths["/api/v1/audit-log"].get).toBeDefined();
    expect(spec.paths["/api/v1/system/audit-log"]).toBeUndefined();
    expect(spec.paths["/api/v1/organizations/content-reviews"].get).toBeDefined();
    expect(spec.paths["/api/v1/organizations/content-reviews/{id}"].get).toBeDefined();
    expect(spec.paths["/api/v1/organizations/content-reviews/{id}/approve"].post).toBeDefined();
    expect(spec.paths["/api/v1/organizations/content-reviews/{id}/reject"].post).toBeDefined();
    expect(spec.paths["/api/v1/system/organization-content-reviews"]).toBeUndefined();
    expect(spec.paths["/api/v1/membership/settings"].get).toBeDefined();
    expect(spec.paths["/api/v1/membership/settings"].patch).toBeDefined();
    expect(spec.paths["/api/v1/membership/categories"].get).toBeDefined();
    expect(spec.paths["/api/v1/membership/categories/{categoryCode}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/system/membership-settings"]).toBeUndefined();
    expect(spec.paths["/api/v1/system/membership-categories"]).toBeUndefined();
    expect(spec.paths["/api/v1/donations"].get).toBeDefined();
    expect(spec.paths["/api/v1/donations/{id}"].get).toBeDefined();
    expect(spec.paths["/api/v1/donations/payments/stripe/webhook"].post).toBeDefined();
    expect(spec.paths["/api/v1/email/sendgrid/webhook"].post).toBeDefined();
    expect(spec.paths["/api/v1/webhooks/stripe"]).toBeUndefined();
    expect(spec.paths["/api/v1/webhooks/sendgrid"]).toBeUndefined();
    expect(spec.paths["/api/v1/donations/promoters"].get).toBeDefined();
    expect(spec.paths["/api/v1/donations/promoters"].post).toBeDefined();
    expect(spec.paths["/api/v1/donations/promoter"]).toBeUndefined();
    expect(spec.paths["/api/v1/donations/sync"].post).toBeDefined();
    expect(spec.paths["/api/v1/email/outbox"].get).toBeDefined();
    expect(spec.paths["/api/v1/email/outbox/process"].post).toBeDefined();
    expect(spec.paths["/api/v1/email/outbox/reset-failed"].post).toBeDefined();
    expect(spec.paths["/api/v1/retention/due"].get).toBeDefined();
    expect(spec.paths["/api/v1/retention/runs"].post).toBeDefined();
    expect(spec.paths["/api/v1/email/reminders/runs"].post).toBeDefined();
    expect(spec.paths["/api/v1/membership/batches/{batchKey}/runs"].post).toBeDefined();
    // The operations bucket is retired; each surface now lives in its own domain.
    expect(spec.paths["/api/v1/operations/due-work"]).toBeUndefined();
    expect(spec.paths["/api/v1/operations/reminders/run"]).toBeUndefined();
    expect(spec.paths["/api/v1/operations/retention/run"]).toBeUndefined();
    // One parameterised route replaces the three per-batch families.
    expect(spec.paths["/api/v1/operations/membership-batches/consultation/run"]).toBeUndefined();
    expect(spec.paths["/api/v1/membership/batches/{batchKey}/runs"].post[AUTH_EXTENSION]).toMatchObject({
      scopes: ["membership:write"],
    });
    expect(spec.paths["/api/v1/email/reminders/runs"].post[AUTH_EXTENSION]).toMatchObject({
      scopes: ["email:manage"],
    });
    expect(spec.paths["/api/v1/retention/runs"].post[AUTH_EXTENSION]).toMatchObject({
      scopes: ["retention:run"],
    });
    expect(spec.paths["/api/v1/admin/donations"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/donations/{id}"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/donations/promoters"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/donations/sync"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/stats"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/email/outbox"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/due-work"]).toBeUndefined();
    expect(spec.paths["/api/v1/internal/email/retry"]).toBeUndefined();
    expect(spec.paths["/api/v1/internal/email/reset-failed"]).toBeUndefined();
    expect(spec.paths["/api/v1/internal/jobs/run"]).toBeUndefined();
    expect(spec.paths["/api/v1/internal/reminders/run"]).toBeUndefined();
    expect(spec.paths["/api/v1/internal/retention/run"]).toBeUndefined();
    expect(spec.paths["/api/v1/internal/calendar/rsvp"]).toBeUndefined();
    expect(spec.paths["/api/v1/calendar/rsvp"].post).toBeDefined();
    // RSVP is authorized by the signature on the link it arrives with, not by
    // a session, so it declares itself public and publishes no bearer
    // requirement. The declaration is what separates that verified decision
    // from a route nobody has examined.
    expect(spec.paths["/api/v1/calendar/rsvp"].post[AUTH_EXTENSION]).toEqual({ required: false });
    expect(spec.paths["/api/v1/calendar/rsvp"].post.security).toBeUndefined();
    expect(spec.paths["/api/v1/admin/votes"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/votes/{id}"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/votes/{id}/visibility"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/votes/{id}/ballots"]).toBeUndefined();
    expect(spec.paths["/api/v1/portal/votes"]).toBeUndefined();
    expect(spec.paths["/api/v1/portal/vote-proposals"]).toBeUndefined();
    expect(spec.paths["/api/v1/me/votes"]).toBeUndefined();
    expect(spec.paths["/api/v1/groups/{groupId}/votes"].get).toBeDefined();
    expect(spec.paths["/api/v1/groups/{groupId}/votes/{voteId}"].get).toBeDefined();
    expect(spec.paths["/api/v1/groups/{groupId}/votes/{voteId}/ballots"].post).toBeDefined();
    expect(spec.paths["/api/v1/groups/{groupId}/vote-proposals"].get).toBeDefined();
    expect(spec.paths["/api/v1/groups/{groupId}/vote-proposals"].post).toBeDefined();
    expect(spec.paths["/api/v1/meetings/occurrences/{occurrenceId}/join"].get).toBeDefined();
    expect(spec.paths["/api/v1/meetings/occurrences/{occurrenceId}/join"].post).toBeDefined();
    expect(spec.paths["/api/v1/meetings/occurrences/{occurrenceId}/invitations/verifications"].post).toBeDefined();
    expect(
      spec.paths["/api/v1/meetings/occurrences/{occurrenceId}/invitations/verifications/{verificationId}"].patch,
    ).toBeDefined();
    expect(spec.paths["/api/v1/me/meetings/occurrences/{occurrenceId}/join"]).toBeUndefined();
    expect(spec.paths["/api/v1/meeting-guests/invitations/bootstrap"]).toBeUndefined();
    expect(spec.paths["/api/v1/meeting-guests/invitations/verify"]).toBeUndefined();
    expect(spec.paths["/api/v1/meeting-guests/meetings/occurrences/{occurrenceId}/join"]).toBeUndefined();
    expect(spec.paths["/api/v1/donations"].get[AUTH_EXTENSION]).toMatchObject({
      required: true,
      scopes: ["donations:read"],
    });
    expect(spec.paths["/api/v1/membership/settings"].get[AUTH_EXTENSION]).toMatchObject({
      required: true,
      scopes: ["membership:read"],
    });
    expect(spec.paths["/api/v1/membership/settings"].patch[AUTH_EXTENSION]).toMatchObject({
      required: true,
      scopes: ["membership:write"],
    });
    expect(spec.paths["/api/v1/membership/categories"].get[AUTH_EXTENSION]).toMatchObject({
      required: true,
      scopes: ["membership:read"],
    });
    expect(spec.paths["/api/v1/membership/categories/{categoryCode}"].patch[AUTH_EXTENSION]).toMatchObject({
      required: true,
      scopes: ["membership:write"],
    });
    expect(spec.paths["/api/v1/organizations/content-reviews"].get[AUTH_EXTENSION]).toMatchObject({
      required: true,
      scopes: ["organizations:content-review"],
    });
    expect(spec.paths["/api/v1/organizations/content-reviews/{id}/approve"].post[AUTH_EXTENSION]).toMatchObject({
      required: true,
      scopes: ["organizations:content-review"],
    });
    expect(spec.paths["/api/v1/donations/sync"].post[AUTH_EXTENSION]).toMatchObject({
      required: true,
      scopes: ["donations:sync"],
    });
    expect(spec.paths["/api/v1/admin/access-grants"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/roles"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/roles/{id}/assignments"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/users/{userId}/roles"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/users/{userId}/roles/{userRoleId}"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/email-templates"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/email-templates/preview"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/email-templates/{key}/versions"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/leadership-positions"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/leadership-positions/{id}"]).toBeUndefined();
    expect(spec.paths["/api/v1/forms"].post).toBeDefined();
    expect(spec.paths["/api/v1/forms/{formKey}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/forms"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/forms/placements/{purpose}"].get).toBeDefined();
    expect(spec.paths["/api/v1/admin/forms"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/forms"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/days"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/days"].put).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/days"]).toBeUndefined();
    expect(spec.paths["/api/v1/groups/{groupId}/events/{eventId}/days"].get).toBeDefined();
    expect(spec.paths["/api/v1/groups/{groupId}/events/{eventId}/days"].put).toBeDefined();
    expect(spec.paths["/api/v1/groups/{groupId}/events/{eventId}/terms"].get).toBeDefined();
    expect(spec.paths["/api/v1/groups/{groupId}/events/{eventId}/terms"].put).toBeDefined();
    expect(spec.paths["/api/v1/admin/users"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/users/{userId}"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/users/{userId}/gravatar"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/members"]).toBeUndefined();
    expect(spec.paths["/api/v1/users/{userId}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/users/{userId}/gravatar"].post).toBeDefined();
    expect(spec.paths["/api/v1/users/current"].get).toBeDefined();
    expect(spec.paths["/api/v1/users/current"].patch).toBeDefined();
    expect(spec.paths["/api/v1/users/current/identities/active"].put).toBeDefined();
    expect(spec.paths["/api/v1/users/current/identities"].get).toBeDefined();
    expect(spec.paths["/api/v1/users/current/identities"].post).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/identities"].get).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/identities"].post).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/representatives"]).toBeUndefined();
    expect(spec.paths["/api/v1/users/current/notifications/preferences"].get).toBeDefined();
    expect(spec.paths["/api/v1/users/current/notifications/preferences"].patch).toBeDefined();
    expect(spec.paths["/api/v1/users/current/headshot"].put).toBeDefined();
    expect(spec.paths["/api/v1/users/current/headshot"].delete).toBeDefined();
    expect(spec.paths["/api/v1/users/current/groups"].get).toBeDefined();
    expect(spec.paths["/api/v1/users/current/applications"].get).toBeDefined();
    expect(spec.paths["/api/v1/users/current/applications/{id}"].get).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/profile"].get).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/content/reviews"].get).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/content/reviews"].post).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/content/reviews/{reviewId}"].delete).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/logo"].post).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/contacts/secondary/nomination"].put).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/contacts/secondary/nomination"].delete).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{organizationId}/sponsors/current"].get).toBeDefined();
    expect(spec.paths["/api/v1/me"]).toBeUndefined();
    expect(spec.paths["/api/v1/me/groups"]).toBeUndefined();
    expect(spec.paths["/api/v1/me/notification-preferences"]).toBeUndefined();
    expect(spec.paths["/api/v1/me/active-membership"]).toBeUndefined();
    expect(spec.paths["/api/v1/me/headshot"]).toBeUndefined();
    expect(spec.paths["/api/v1/me/applications"]).toBeUndefined();
    expect(spec.paths["/api/v1/me/applications/{id}"]).toBeUndefined();
    expect(spec.paths["/api/v1/me/applications/{id}/ec-decision"]).toBeUndefined();
    expect(spec.paths["/api/v1/members/capacities"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/roles"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/roles"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/roles/{roleAssignmentId}"].delete).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/permissions"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/promoters"].get).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/promoters"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/presentations/archive"].get).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/presentations/download"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/analytics"].get).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/stats"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/invites/attendees/bulk"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/invites/speakers/bulk"]).toBeUndefined();
    expect(spec.paths["/api/v1/groups/{groupId}/events/{eventId}/invites/attendees/bulk"].post).toBeDefined();
    expect(spec.paths["/api/v1/groups/{groupId}/events/{eventId}/invites/speakers/bulk"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/exports"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/promotions"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/{registrationId}"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/{registrationId}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/{registrationId}/badge"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/{registrationId}/badge"].patch).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/{registrationId}/badge"].post).toBeDefined();
    expect(
      spec.paths["/api/v1/admin/events/{eventSlug}/registrations/{registrationId}/day-attendance"],
    ).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/{registrationId}/access"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/{registrationId}/admissions"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/{registrationId}/audit"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/{registrationId}/notifications"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/registrations"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/registrations/{registrationId}"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/waitlist/promote"]).toBeUndefined();
  });

  it("documents the geolocation country response through its shared response schema", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const geolocationCountryGet = spec.paths["/api/v1/geolocation/country"].get;

    expect(geolocationCountryGet).toBeDefined();
    expect(geolocationCountryGet.responses["200"].content["application/json"].schema).toMatchObject({
      type: "object",
      required: ["country"],
      properties: { country: { type: ["string", "null"] } },
    });
    expect(spec.paths["/api/v1/geo"]).toBeUndefined();
  });

  it("includes required scopes on decorated proposal operations", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const operation = spec.paths["/api/v1/proposals/{proposalId}/reviews"].post;

    expect(operation.security).toEqual([{ BearerAuth: ["proposals:score"] }]);
    expect(operation[AUTH_EXTENSION]).toEqual({
      required: true,
      scheme: "BearerAuth",
      scopes: ["proposals:score"],
    });
    expect(operation["x-pkic-required-scopes"]).toEqual(["proposals:score"]);
    expect(operation.description).toContain("Required scopes: `proposals:score`.");
  });

  it("documents accepted-abstract editing as alternative least-privilege scopes", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const operation = spec.paths["/api/v1/proposals/{proposalId}"].patch;
    const alternatives = [["proposals:manage"], ["proposals:edit_accepted_abstract"]];

    expect(operation.security).toEqual(alternatives.map((scopes) => ({ BearerAuth: scopes })));
    expect(operation[AUTH_EXTENSION]).toMatchObject({ required: true, scopesAnyOf: alternatives });
    expect(operation["x-pkic-required-scopes-any-of"]).toEqual(alternatives);
    expect(operation.description).toContain("Required scope alternative:");
  });

  it("documents role ids as plain strings, not uuid()-formatted, so built-in system roles are valid per the spec (Phase 3 §3.1)", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const rolesGet = spec.paths["/api/v1/roles"].get;
    const roleIdSchema =
      rolesGet.responses["200"].content["application/json"].schema.properties.roles.items.properties.id;

    expect(roleIdSchema.type).toBe("string");
    expect(roleIdSchema.format).toBeUndefined();
  });

  it("uses structured schemas for registration confirmation day arrays", () => {
    const dayAttendanceSchema = registrationConfirmResponseSchema.shape.dayAttendance;
    const dayWaitlistSchema = registrationConfirmResponseSchema.shape.dayWaitlist;

    expect(z.toJSONSchema(dayAttendanceSchema)).toMatchObject({
      type: "array",
      items: {
        type: "object",
        required: ["dayDate", "attendanceType", "label"],
      },
    });
    expect(z.toJSONSchema(dayWaitlistSchema)).toMatchObject({
      type: "array",
      items: {
        type: "object",
        required: ["dayDate", "status", "priorityLane", "offerExpiresAt"],
      },
    });
  });

  it("publishes schema-owned list defaults in OpenAPI", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const publicVotesGet = spec.paths["/api/v1/votes"].get;
    const limit = publicVotesGet.parameters.find(
      (parameter: { in?: string; name?: string }) => parameter.in === "query" && parameter.name === "limit",
    );
    const offset = publicVotesGet.parameters.find(
      (parameter: { in?: string; name?: string }) => parameter.in === "query" && parameter.name === "offset",
    );

    expect(limit).toMatchObject({ required: false, schema: { default: 20, maximum: 200, minimum: 1 } });
    expect(offset).toMatchObject({ required: false, schema: { default: 0, minimum: 0 } });
  });
});
