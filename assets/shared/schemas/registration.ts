import { z } from "zod";
import {
  firstNameSchema,
  jobTitleSchema,
  lastNameSchema,
  normalizedEmailSchema,
  organizationNameSchema,
  registrationManageTokenParamsSchema,
  termKeyPattern,
  tokenSchema,
  trimmedString,
  versionPattern,
} from "./api-common";
import { linksSchema } from "./links";
import { defaultedSourceTypeSchema } from "./source";

export const REGISTRATION_HEADSHOT_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const REGISTRATION_HEADSHOT_MAX_BYTES = 2 * 1024 * 1024;

export const registrationHeadshotUploadFormSchema = z.object({
  consent: z
    .enum(["true"])
    .describe("Consent declaring the attendee owns/has rights to the uploaded photo of themselves"),
  file: z
    .any()
    .describe(
      `Headshot image binary file (accepted MIME types: ${REGISTRATION_HEADSHOT_ALLOWED_MIME_TYPES.join(", ")})`,
    ),
});

export const registrationHeadshotUploadResponseSchema = z.object({
  success: z.boolean(),
  headshotUrl: z.string().url().describe("The permanent URL pointing to the new uploaded headshot profile asset"),
});

export const successResponseSchema = z.object({ success: z.boolean() });

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

export const adminHeadshotUploadResponseSchema = z.object({
  success: z.boolean(),
  r2Key: z.string().describe("R2 object key for the uploaded headshot"),
});

export const attendanceTypeSchema = z.enum(["in_person", "virtual", "on_demand"]);

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

const customAnswerScalarSchema = z.union([z.string().trim().max(500), z.number().finite(), z.boolean()]);
const customAnswerDateRangeSchema = z
  .object({ start: dayDateSchema, end: dayDateSchema })
  .superRefine((value, context) => {
    if (value.start > value.end) {
      context.addIssue({
        code: "custom",
        message: "start must be less than or equal to end",
        path: ["start"],
      });
    }
  });
const customAnswerValueSchema = z.union([
  customAnswerScalarSchema,
  z.array(customAnswerScalarSchema).max(25),
  customAnswerDateRangeSchema,
]);
export const customAnswersSchema = z.record(z.string().trim().min(1).max(64), customAnswerValueSchema);

export const userProfileSchema = z.object({
  firstName: firstNameSchema,
  lastName: lastNameSchema,
  email: normalizedEmailSchema,
  organizationName: organizationNameSchema.optional(),
  jobTitle: jobTitleSchema.optional(),
});

const speakerBioSchema = trimmedString(40, 5000);
export const speakerRoleSchema = z.enum(["proposer", "speaker", "co_speaker", "moderator", "panelist"]);

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

export const registrationCreateSchema = z
  .object({
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    email: normalizedEmailSchema,
    organizationName: organizationNameSchema.optional(),
    jobTitle: jobTitleSchema.optional(),
    attendanceType: attendanceTypeSchema.optional(),
    dayAttendance: z.array(dayAttendanceItemSchema).max(31).optional(),
    sourceType: defaultedSourceTypeSchema,
    sourceRef: trimmedString(2, 200).optional(),
    customAnswers: customAnswersSchema.optional(),
    inviteToken: tokenSchema.optional(),
    inviteId: z.uuid().optional(),
    referralCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6,12}$/)
      .optional(),
    consents: z.array(consentItemSchema).min(1).max(20),
  })
  .superRefine(requireAttendance);

export const registrationConfirmSchema = z.object({ id: z.uuid().optional(), token: tokenSchema });
export const registrationConfirmQuerySchema = registrationConfirmSchema;

export const registrationConfirmResponseSchema = z.object({
  success: z.boolean(),
  status: z.string(),
  shareUrl: z.string().url().nullable(),
  manageUrl: z.string().url(),
  manageToken: z.string(),
  dayAttendance: z.array(dayAttendanceItemSchema),
  dayWaitlist: z.array(dayWaitlistItemSchema),
});

export const registrationResendConfirmationSchema = z
  .object({
    id: z.uuid().optional(),
    token: z.string().min(1).optional(),
    email: normalizedEmailSchema.optional(),
  })
  .refine((value) => Boolean(value.token || value.email), { message: "token or email is required" });

export const okResponseSchema = z.object({ ok: z.boolean() });

export const registrationManageSchema = z.object({
  action: z.enum(["update", "cancel", "report_unauthorized"]),
  attendanceType: attendanceTypeSchema.optional(),
  dayAttendance: z.array(dayAttendanceItemSchema).max(31).optional(),
  customAnswers: customAnswersSchema.optional(),
  sourceRef: trimmedString(2, 200).optional(),
  email: normalizedEmailSchema.optional(),
  firstName: firstNameSchema.optional(),
  lastName: lastNameSchema.optional(),
  organizationName: organizationNameSchema.optional(),
  jobTitle: jobTitleSchema.optional(),
});

export const registrationInviteCreateSchema = z.object({ invites: z.array(inviteeSchema).min(1).max(10) });

export const inviteDeclineSchema = z
  .object({
    reasonCode: declineReasonCodeSchema,
    reasonNote: trimmedString(3, 2000).optional(),
    unsubscribeFuture: z.boolean().optional(),
    npsScore: z.number().int().min(1).max(10).optional(),
    forwards: z.array(inviteeSchema).max(5).optional(),
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

export const inviteAcceptAttendeeSchema = z
  .object({
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    email: normalizedEmailSchema,
    organizationName: organizationNameSchema.optional(),
    jobTitle: jobTitleSchema.optional(),
    attendanceType: attendanceTypeSchema.optional(),
    dayAttendance: z.array(dayAttendanceItemSchema).max(31).optional(),
    customAnswers: customAnswersSchema.optional(),
    consents: z.array(consentItemSchema).min(1).max(20),
  })
  .superRefine(requireAttendance);
