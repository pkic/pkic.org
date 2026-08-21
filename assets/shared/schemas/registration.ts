import { z } from "zod";
import { formAnswersSchema } from "./form-answers";
import { databaseIdSchema } from "./identifiers";
import {
  emailRecoveryRequestSchema,
  firstNameSchema,
  eventSlugParamsSchema,
  jobTitleSchema,
  lastNameSchema,
  normalizedEmailSchema,
  organizationNameSchema,
  registrationManageTokenParamsSchema,
  successResponseSchema,
  termKeyPattern,
  tokenSchema,
  trimmedString,
  versionPattern,
} from "./api-common";
import { linksSchema } from "./links";
import { defaultedSourceTypeSchema } from "./source";
import { IMAGE_UPLOAD_ALLOWED_MIME_TYPES } from "./images";
import { proposalSpeakerRoleSchema } from "./participant-roles";
import { httpUrlSchema } from "./urls";

export { REGISTRATION_HEADSHOT_MAX_BYTES } from "./images";
export const REGISTRATION_HEADSHOT_ALLOWED_MIME_TYPES = IMAGE_UPLOAD_ALLOWED_MIME_TYPES;

export const headshotImageUploadFormSchema = z.object({
  file: z
    .any()
    .describe(
      `Headshot image binary file (accepted MIME types: ${REGISTRATION_HEADSHOT_ALLOWED_MIME_TYPES.join(", ")})`,
    ),
});

export const registrationHeadshotUploadFormSchema = headshotImageUploadFormSchema.extend({
  consent: z
    .enum(["true"])
    .describe("Consent declaring the attendee owns/has rights to the uploaded photo of themselves"),
});

export const headshotUploadResponseSchema = successResponseSchema.extend({
  r2Key: z.string().describe("R2 object key for the uploaded headshot"),
  headshotUrl: httpUrlSchema.describe("URL pointing to the uploaded headshot"),
});
export const registrationHeadshotUploadResponseSchema = headshotUploadResponseSchema.omit({ r2Key: true }).extend({
  headshotUrl: httpUrlSchema.describe("The permanent URL pointing to the new uploaded headshot profile asset"),
});

export const registrationResendManageLinkSchema = emailRecoveryRequestSchema;

export const registrationHeadshotUploadRouteSchema = {
  tags: ["Registrations", "Headshots"],
  summary: "Upload or replace registration headshot",
  description:
    "Uploads or replaces the attendee's profile headshot image which is dynamically rendered in social badge images. Requires a valid registration management token as path parameter.",
  request: {
    params: registrationManageTokenParamsSchema,
    body: {
      content: { "multipart/form-data": { schema: registrationHeadshotUploadFormSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Headshot image uploaded and processed successfully.",
      content: { "application/json": { schema: registrationHeadshotUploadResponseSchema } },
    },
    "400": { description: "Invalid request payload format, or file parameter is missing." },
    "413": { description: "Uploaded file exceeds the maximum allowed size." },
    "503": { description: "R2 upload buckets are not configured/reachable." },
  },
};

export const registrationHeadshotDeleteRouteSchema = {
  tags: ["Registrations", "Headshots"],
  summary: "Delete registration headshot",
  description:
    "Deletes the attendee's profile headshot image from active storage and clears references. Requires a valid registration management token.",
  request: { params: registrationManageTokenParamsSchema },
  responses: {
    "200": {
      description: "Headshot removed successfully.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "404": { description: "User details matching parent token were not found." },
  },
};

export const adminHeadshotUploadResponseSchema = headshotUploadResponseSchema.omit({ headshotUrl: true });

export const attendanceTypeSchema = z.enum(["in_person", "virtual", "on_demand"]);

/**
 * Application lifecycle statuses after migration 0030. The deployed base
 * table still admits the retired `waitlisted` token in its CHECK constraint;
 * removing that storage compatibility would require rebuilding the D1 table.
 * Day waitlist rows are the sole authoritative waitlist state.
 */
export const registrationLifecycleStatusSchema = z.enum(["pending_email_confirmation", "registered", "cancelled"]);
export type RegistrationLifecycleStatus = z.infer<typeof registrationLifecycleStatusSchema>;

// Attendance options are configurable per event day; the service validates
// this bounded identifier against the event's stored options.
export const dayAttendanceTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z_][a-z0-9_]*$/, "Invalid attendance type");

export const inviteTypeSchema = z.enum(["attendee", "speaker"]);
export const declineReasonCodeSchema = z.enum([
  "not_interested",
  "schedule_conflict",
  "travel_not_possible",
  "organization_policy",
  "content_not_relevant",
  "already_registered",
  "other",
]);

export const consentItemSchema = z.object({
  termKey: z.string().trim().regex(termKeyPattern),
  version: z.string().trim().regex(versionPattern),
});

export const dayDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/);

export const dayAttendanceItemSchema = z.object({
  dayDate: dayDateSchema,
  attendanceType: dayAttendanceTypeSchema,
});

export const dayWaitlistItemSchema = z.object({
  dayDate: dayDateSchema,
  status: z.enum(["waiting", "offered", "accepted"]),
  priorityLane: z.enum(["continuity", "general"]),
  offerExpiresAt: z.string().trim().nullable(),
});

export const registrationDayAttendanceResponseItemSchema = dayAttendanceItemSchema.extend({
  label: z.string().nullable(),
});

export const registrationDayStateSchema = z.object({
  dayAttendance: z.array(registrationDayAttendanceResponseItemSchema),
  dayWaitlist: z.array(dayWaitlistItemSchema),
});

/** Backward-compatible name for the canonical portal-managed form answer contract. */
export const customAnswersSchema = formAnswersSchema;

export const userProfileSchema = z.object({
  firstName: firstNameSchema,
  lastName: lastNameSchema,
  email: normalizedEmailSchema,
  organizationName: organizationNameSchema.optional(),
  jobTitle: jobTitleSchema.optional(),
});

const speakerBioSchema = trimmedString(40, 5000);
export const speakerRoleSchema = proposalSpeakerRoleSchema;
export type SpeakerRole = z.infer<typeof speakerRoleSchema>;

export const participantProfileSchema = userProfileSchema.extend({
  bio: speakerBioSchema,
  links: linksSchema.default([]),
});

export const proposerProfileSchema = userProfileSchema.extend({
  bio: speakerBioSchema.optional(),
  links: linksSchema.default([]),
  role: speakerRoleSchema.default("proposer"),
});

export const inviteeSchema = z.object({
  email: normalizedEmailSchema,
  firstName: firstNameSchema.optional(),
  lastName: lastNameSchema.optional(),
});

function requireAttendance(
  value: { attendanceType?: string; dayAttendance?: unknown[] },
  context: z.core.$RefinementCtx,
): void {
  if (!value.attendanceType && (!value.dayAttendance || value.dayAttendance.length === 0)) {
    context.addIssue({
      code: "custom",
      path: ["attendanceType"],
      message: "attendanceType or dayAttendance is required",
      input: value,
    });
  }
}

export const attendeeRegistrationFieldsSchema = z.object({
  firstName: firstNameSchema,
  lastName: lastNameSchema,
  email: normalizedEmailSchema,
  organizationName: organizationNameSchema.optional(),
  jobTitle: jobTitleSchema.optional(),
  attendanceType: attendanceTypeSchema.optional(),
  dayAttendance: z.array(dayAttendanceItemSchema).max(31).optional(),
  customAnswers: customAnswersSchema.optional(),
  consents: z.array(consentItemSchema).min(1).max(20),
});
export type AttendeeRegistrationFields = z.infer<typeof attendeeRegistrationFieldsSchema>;

export const registrationCreateSchema = attendeeRegistrationFieldsSchema
  .extend({
    sourceType: defaultedSourceTypeSchema,
    sourceRef: trimmedString(2, 200).optional(),
    inviteToken: tokenSchema.optional(),
    inviteId: databaseIdSchema.optional(),
    referralCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6,12}$/)
      .optional(),
  })
  .superRefine(requireAttendance);

export const registrationConfirmSchema = z.object({ id: databaseIdSchema.optional(), token: tokenSchema });
export const registrationConfirmQuerySchema = registrationConfirmSchema;

const registrationCompletionResponseSchema = successResponseSchema.merge(registrationDayStateSchema).extend({
  status: registrationLifecycleStatusSchema,
  shareUrl: httpUrlSchema.nullable(),
  manageUrl: httpUrlSchema,
  manageToken: z.string(),
});

export const registrationConfirmResponseSchema = registrationCompletionResponseSchema;

export const registrationSubmissionResponseSchema = registrationCompletionResponseSchema.extend({
  registrationId: databaseIdSchema,
});
export type RegistrationSubmissionResponse = z.infer<typeof registrationSubmissionResponseSchema>;

export const registrationResendConfirmationSchema = z
  .object({
    id: databaseIdSchema.optional(),
    token: z.string().min(1).optional(),
    email: normalizedEmailSchema.optional(),
  })
  .refine((value) => Boolean(value.token || value.email), { message: "token or email is required" });

export const okResponseSchema = z.object({ ok: z.boolean() });

export const registrationManageSchema = z.object({
  action: z.enum(["update", "cancel", "report_unauthorized"]),
  attendanceType: attendanceTypeSchema.optional(),
  dayAttendance: z.array(dayAttendanceItemSchema).max(31).optional(),
  claimDayWaitlistOffers: z.array(dayDateSchema).max(31).optional(),
  customAnswers: customAnswersSchema.optional(),
  sourceRef: trimmedString(2, 200).optional(),
  email: normalizedEmailSchema.optional(),
  firstName: firstNameSchema.optional(),
  lastName: lastNameSchema.optional(),
  organizationName: organizationNameSchema.optional(),
  jobTitle: jobTitleSchema.optional(),
});

export const registrationInviteCreateSchema = z.object({ invites: z.array(inviteeSchema).min(1).max(10) });

export const peerInviteResultSchema = successResponseSchema.extend({
  created: z.array(z.object({ email: normalizedEmailSchema })),
  endorsed: z.array(z.object({ email: normalizedEmailSchema })),
  skipped: z.array(z.object({ email: normalizedEmailSchema, reason: z.string() })),
  referralCode: z.string().optional(),
});

function peerInviteRouteSchema(summary: string, description: string) {
  return {
    tags: ["Events", "Invites"],
    summary,
    description,
    request: {
      params: eventSlugParamsSchema,
      body: { content: { "application/json": { schema: registrationInviteCreateSchema } }, required: true },
    },
    responses: {
      "200": {
        description: "Invites were created, endorsed, or skipped.",
        content: { "application/json": { schema: peerInviteResultSchema } },
      },
      "400": { description: "Invalid invite payload." },
      "401": { description: "Registration manage token required." },
      "403": { description: "The manage token is not valid for this event." },
      "429": { description: "Invite quota exceeded." },
    },
  };
}

export const attendeePeerInvitesRouteSchema = peerInviteRouteSchema(
  "Create attendee peer invites",
  "Creates or endorses a bounded set of attendee invitations using the caller's registration manage capability.",
);
export const speakerPeerInvitesRouteSchema = peerInviteRouteSchema(
  "Create speaker peer nominations",
  "Creates or endorses a bounded set of speaker nominations using the caller's registration manage capability.",
);

export const INVITE_FORWARD_LIMIT = 5;

export const inviteDeclineSchema = z
  .object({
    reasonCode: declineReasonCodeSchema,
    reasonNote: trimmedString(3, 2000).optional(),
    unsubscribeFuture: z.boolean().optional(),
    npsScore: z.number().int().min(1).max(10).optional(),
    forwards: z.array(inviteeSchema).max(INVITE_FORWARD_LIMIT).optional(),
  })
  .superRefine((value, context) => {
    if (value.reasonCode === "other" && !value.reasonNote) {
      context.addIssue({
        code: "custom",
        path: ["reasonNote"],
        message: "reasonNote is required when reasonCode is 'other'",
        input: value,
      });
    }
  });

export const inviteAcceptAttendeeSchema = attendeeRegistrationFieldsSchema.superRefine(requireAttendance);
