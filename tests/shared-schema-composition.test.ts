import { describe, expect, it } from "vitest";
import {
  roleAssignmentTargetSchema,
  roleAssignmentSchema,
  userRoleResponseSchema,
} from "../assets/shared/schemas/access-control";
import {
  eventRegistrationSummarySchema,
  eventRegistrationsListResponseSchema,
} from "../assets/shared/schemas/event-registrations";
import { eventRegistrationDetailSchema } from "../assets/shared/schemas/event-registration-detail";
import { registrationRecordContextSchema } from "../assets/shared/schemas/registration-record";
import { organizationManagementLogoPutRouteSchema } from "../assets/shared/schemas/organization-management";
import {
  sponsorshipCreateSchema,
  sponsorshipEditableFieldsSchema,
  sponsorshipLogoPutRouteSchema,
  sponsorshipUpdateSchema,
} from "../assets/shared/schemas/sponsorship-management";
import { logoUploadResponseSchema } from "../assets/shared/schemas/images";
import {
  eventSeriesCreateSchema,
  eventSeriesParamsSchema,
  eventSeriesUpdateRouteSchema,
  eventSeriesUpdateSchema,
  groupMeetingSeriesCreateRouteSchema,
  groupMeetingSeriesParamsSchema,
} from "../assets/shared/schemas/event-series";
import {
  authenticationResponseSchema,
  passkeyAuthenticateCompleteBaseResponseSchema,
  publicKeyCredentialEnvelopeSchema,
  registrationResponseSchema,
} from "../assets/shared/schemas/passkeys";
import { successResponseSchema } from "../assets/shared/schemas/api-common";
import { headshotUploadResponseSchema } from "../assets/shared/schemas/registration";
import { memberAuthVerifyResponseSchema } from "../assets/shared/schemas/member-auth";
import { sponsorPortalAuthVerifyResponseSchema } from "../assets/shared/schemas/sponsor-portal";
import { memberCapacityMutationResponseSchema } from "../assets/shared/schemas/membership-management";
import { emailTemplateVersionCreateResponseSchema } from "../assets/shared/schemas/email-templates";
import { eventProposalsResponseSchema } from "../assets/shared/schemas/event-proposals";
import { adminEventStatsResponseSchema } from "../assets/shared/schemas/admin-analytics";
import { eventSummarySchema } from "../assets/shared/schemas/event-read-models";
import { eventInviteValiditySchema } from "../assets/shared/schemas/event-invite-validity";
import { registrationInviteCreateSchema } from "../assets/shared/schemas/registration";

const ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

describe("canonical shared schema composition", () => {
  it("reuses event invite validity for peer invitation creation", () => {
    expect(registrationInviteCreateSchema.shape.expiresAt).toBe(eventInviteValiditySchema.shape.expiresAt);
    expect(
      registrationInviteCreateSchema.parse({
        invites: [{ email: "speaker@example.test" }],
        expiresAt: "2026-12-02T12:00:00.000Z",
      }).expiresAt,
    ).toBe("2026-12-02T12:00:00.000Z");
    expect(
      registrationInviteCreateSchema.safeParse({
        invites: [{ email: "speaker@example.test" }],
        expiresAt: "not-a-date",
      }).success,
    ).toBe(false);
  });

  it("uses one event identity contract across event workflow responses", () => {
    expect(eventProposalsResponseSchema.shape.event).toBe(eventSummarySchema);
    expect(eventRegistrationsListResponseSchema.shape.event).toBe(eventSummarySchema);
    expect(adminEventStatsResponseSchema.shape.event).toBe(eventSummarySchema);

    const valid = { id: ID, slug: "pqc-2026", name: "PQC Conference 2026" };
    expect(eventSummarySchema.parse(valid)).toEqual(valid);
    for (const schema of [
      eventProposalsResponseSchema.shape.event,
      eventRegistrationsListResponseSchema.shape.event,
      adminEventStatsResponseSchema.shape.event,
    ]) {
      expect(schema.safeParse({ ...valid, id: "" }).success).toBe(false);
    }
  });

  it("uses one success envelope across unrelated API domains", () => {
    for (const schema of [
      headshotUploadResponseSchema,
      memberAuthVerifyResponseSchema,
      sponsorPortalAuthVerifyResponseSchema,
      passkeyAuthenticateCompleteBaseResponseSchema,
    ]) {
      expect(schema.shape.success).toBe(successResponseSchema.shape.success);
      expect(schema.safeParse({ success: false }).success).toBe(false);
    }
    expect(successResponseSchema.parse({ success: true })).toEqual({ success: true });
  });

  it("keeps admin mutation payloads explicit instead of treating them as success-only commands", () => {
    expect(
      memberCapacityMutationResponseSchema.parse({
        member: {
          id: ID,
          userId: SECOND_ID,
          organizationId: null,
          membershipCategory: "H5",
          status: "active",
          showOnOrgProfile: true,
          createdAt: "2026-08-21T12:00:00Z",
        },
      }).member.membershipCategory,
    ).toBe("H5");

    expect(
      emailTemplateVersionCreateResponseSchema.parse({
        success: true,
        version: {
          id: ID,
          template_key: "welcome",
          version: 1,
          subject_template: "Welcome",
          body: "Hello",
          content_type: "markdown",
          r2_object_key: null,
          checksum_sha256: "a".repeat(64),
          status: "draft",
          created_by_user_id: SECOND_ID,
          created_at: "2026-08-21T12:00:00Z",
          message_type: "transactional",
        },
      }).version.version,
    ).toBe(1);
  });

  it("uses one role-assignment context contract for holder and user projections", () => {
    for (const field of ["contextType", "contextId", "expiresAt", "createdAt"] as const) {
      expect(roleAssignmentSchema.shape[field]).toBe(roleAssignmentTargetSchema.shape[field]);
      expect(userRoleResponseSchema.shape[field]).toBe(roleAssignmentTargetSchema.shape[field]);
    }

    expect(
      roleAssignmentSchema.parse({
        userRoleId: ID,
        userId: SECOND_ID,
        name: "Ada Lovelace",
        email: "ada@example.test",
        contextType: "event",
        contextId: ID,
        expiresAt: null,
        createdAt: "2026-08-21T12:00:00Z",
      }).contextType,
    ).toBe("event");
    expect(
      userRoleResponseSchema.safeParse({
        id: ID,
        userId: SECOND_ID,
        roleId: "role-admin",
        roleName: "Admin",
        contextType: "unknown",
        contextId: null,
        expiresAt: null,
        createdAt: "2026-08-21T12:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("uses one registration record context in list and detail projections", () => {
    for (const field of ["created_at", "updated_at", "user_email", "display_name", "referral_code"] as const) {
      expect(eventRegistrationSummarySchema.shape[field]).toBe(registrationRecordContextSchema.shape[field]);
      expect(eventRegistrationDetailSchema.shape[field]).toBe(registrationRecordContextSchema.shape[field]);
    }

    const recordContext = {
      created_at: "2026-08-21T12:00:00Z",
      updated_at: "2026-08-21T13:00:00Z",
      user_email: "ada@example.test",
      display_name: "Ada Lovelace",
      referral_code: null,
    };
    expect(registrationRecordContextSchema.parse(recordContext)).toEqual(recordContext);
    expect(registrationRecordContextSchema.safeParse({ ...recordContext, created_at: 123 }).success).toBe(false);

    const summary = eventRegistrationSummarySchema.parse({
      ...recordContext,
      id: ID,
      user_id: SECOND_ID,
      status: "registered",
      attendance_type: "in_person",
      source_type: "direct",
      rsvp_events_json: null,
      has_bounced: false,
      sponsor_consent: true,
      custom_answers_json: null,
      dayWaitlistSummary: null,
      dayWaitlistCount: 0,
      attendanceChangeHistory: [],
      lastAttendanceChange: null,
    });
    expect(summary.display_name).toBe("Ada Lovelace");

    const detail = eventRegistrationDetailSchema.parse({
      ...recordContext,
      id: ID,
      event_id: SECOND_ID,
      user_id: ID,
      status: "registered",
      cancellation_reason_code: null,
      attendance_type: "in_person",
      source_type: "direct",
      rsvp_status: null,
      rsvpByDay: [],
      customAnswers: null,
    });
    expect(detail.referral_code).toBeNull();
  });

  it("uses one stored-logo response on organization and sponsorship uploads", () => {
    const organizationResponse =
      organizationManagementLogoPutRouteSchema.responses["200"].content["application/json"].schema;
    const sponsorshipResponse = sponsorshipLogoPutRouteSchema.responses["200"].content["application/json"].schema;
    expect(organizationResponse).toBe(logoUploadResponseSchema);
    expect(sponsorshipResponse).toBe(logoUploadResponseSchema);

    expect(
      logoUploadResponseSchema.parse({ success: true, r2Key: "logos/example.webp", logoUrl: "/api/v1/logo/example" }),
    ).toEqual({ success: true, r2Key: "logos/example.webp", logoUrl: "/api/v1/logo/example" });
    expect(
      logoUploadResponseSchema.safeParse({ success: true, r2Key: "logos/example.webp", logoUrl: "javascript:x" })
        .success,
    ).toBe(false);
  });

  it("uses one sponsorship editable-fields contract for create and update", () => {
    expect(sponsorshipUpdateSchema).toBe(sponsorshipEditableFieldsSchema);
    for (const field of ["tier", "assignedToUserId", "renewalDate", "notes"] as const) {
      expect(sponsorshipCreateSchema.shape[field]).toBe(sponsorshipEditableFieldsSchema.shape[field]);
    }

    expect(
      sponsorshipCreateSchema.parse({
        sponsorType: "event",
        eventId: ID,
        nonMemberName: "Example Sponsor",
        tier: "Gold",
        renewalDate: "2027-08-21",
      }).tier,
    ).toBe("Gold");
    expect(sponsorshipUpdateSchema.parse({ assignedToUserId: SECOND_ID, notes: null })).toEqual({
      assignedToUserId: SECOND_ID,
      notes: null,
    });
    expect(sponsorshipUpdateSchema.safeParse({ renewalDate: "21-08-2027" }).success).toBe(false);
    expect(
      sponsorshipCreateSchema.safeParse({ sponsorType: "event", eventId: ID, notes: "x".repeat(5001) }).success,
    ).toBe(false);
  });

  it("builds canonical group meeting routes from shared event-series contracts", () => {
    expect(groupMeetingSeriesCreateRouteSchema.request.params).toBe(groupMeetingSeriesParamsSchema);
    expect(groupMeetingSeriesCreateRouteSchema.request.body.content["application/json"].schema).toBe(
      eventSeriesCreateSchema,
    );
    expect(eventSeriesUpdateRouteSchema.request.params).toBe(eventSeriesParamsSchema);
    expect(eventSeriesUpdateRouteSchema.request.body.content["application/json"].schema).toBe(eventSeriesUpdateSchema);
    const expectedUpdatedAt = "2026-08-25T12:00:00.000Z";
    expect(eventSeriesUpdateSchema.parse({ eventName: "Weekly call", active: true, expectedUpdatedAt })).toEqual({
      eventName: "Weekly call",
      active: true,
      expectedUpdatedAt,
    });
  });

  it("uses one WebAuthn credential envelope for registration and authentication", () => {
    for (const field of ["id", "rawId", "authenticatorAttachment", "clientExtensionResults", "type"] as const) {
      expect(registrationResponseSchema.shape[field]).toBe(publicKeyCredentialEnvelopeSchema.shape[field]);
      expect(authenticationResponseSchema.shape[field]).toBe(publicKeyCredentialEnvelopeSchema.shape[field]);
    }

    expect(
      registrationResponseSchema.parse({
        id: "credential-id",
        rawId: "raw-id",
        response: { clientDataJSON: "client-data", attestationObject: "attestation" },
        clientExtensionResults: {},
        type: "public-key",
      }).type,
    ).toBe("public-key");
    expect(
      authenticationResponseSchema.parse({
        id: "credential-id",
        rawId: "raw-id",
        response: { clientDataJSON: "client-data", authenticatorData: "authenticator", signature: "signature" },
        clientExtensionResults: {},
        type: "public-key",
      }).response.signature,
    ).toBe("signature");
    expect(
      authenticationResponseSchema.safeParse({
        id: "credential-id",
        rawId: "raw-id",
        response: { clientDataJSON: "client-data", authenticatorData: "authenticator", signature: "signature" },
        clientExtensionResults: {},
        type: "password",
      }).success,
    ).toBe(false);
  });

  it("keeps the composed registration list envelope valid", () => {
    expect(
      eventRegistrationsListResponseSchema.safeParse({
        registrations: [],
        page: { limit: 25, offset: 0, hasMore: false, total: 0 },
        event: { id: ID, slug: "event", name: "Event" },
        stats: {
          byAttendanceType: {},
          attendanceStatusByType: {},
          byStatus: {},
          bouncedCount: 0,
          consentCount: 0,
        },
      }).success,
    ).toBe(true);
  });
});
