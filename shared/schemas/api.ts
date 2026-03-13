import { z } from "zod";
import { SOURCE_TYPES } from "../constants/source-types";

const namePattern = /^[\p{L}\p{N} .,'’\-()&/]+$/u;
const slugPattern = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
const termKeyPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const tokenPattern = /^[A-Za-z0-9_-]{16,256}$/;
const frontendPathPattern = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/;

function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

function boundedJsonObject<T extends z.ZodRawShape>(shape: T, maxLength: number) {
  return z.object(shape).superRefine((value, ctx) => {
    if (JSON.stringify(value).length > maxLength) {
      ctx.addIssue({
        code: "custom",
        message: `JSON payload exceeds ${maxLength} characters`,
      });
    }
  });
}

function uniqueStringList(values: string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size === values.length;
}

export const normalizedEmailSchema = z
  .email({ error: "Please enter a valid email address (for example: name@example.com)." })
  .transform((value) => value.trim().toLowerCase());
export const firstNameSchema = trimmedString(1, 80).regex(namePattern, "Contains unsupported characters");
export const lastNameSchema = trimmedString(1, 120).regex(namePattern, "Contains unsupported characters");
export const organizationNameSchema = trimmedString(2, 160);
export const jobTitleSchema = trimmedString(2, 120);
export const tokenSchema = z.string().trim().regex(tokenPattern, "Invalid token format");

export const attendanceTypeSchema = z.enum(["in_person", "virtual", "on_demand"]);
// dayAttendanceTypeSchema accepts any non-empty string because attendance options
// are now configurable per event day (e.g. 'in_person', 'on_demand', 'virtual').
// Application-layer validation in enforceDayCapacity checks the value against
// the event's configured options.
export const dayAttendanceTypeSchema = z.string().min(1).max(64).regex(/^[a-z_][a-z0-9_]*$/, "Invalid attendance type");
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
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

const dayDateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
export const dayAttendanceItemSchema = z.object({
  dayDate: dayDateSchema,
  attendanceType: dayAttendanceTypeSchema,
});

const customAnswerScalarSchema = z.union([z.string().trim().max(500), z.number().finite(), z.boolean()]);
const customAnswerDateRangeSchema = z.object({
  start: dayDateSchema,
  end: dayDateSchema,
}).superRefine((value, ctx) => {
  if (value.start > value.end) {
    ctx.addIssue({
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

const linkUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Only http/https links are allowed");

export const linksSchema = z
  .array(linkUrlSchema)
  .max(15)
  .superRefine((values, ctx) => {
    if (!uniqueStringList(values)) {
      ctx.addIssue({
        code: "custom",
        message: "Duplicate links are not allowed",
      });
    }
  });

export const userProfileSchema = z.object({
  firstName: firstNameSchema,
  lastName: lastNameSchema,
  email: normalizedEmailSchema,
  organizationName: organizationNameSchema.optional(),
  jobTitle: jobTitleSchema.optional(),
});

const speakerBioSchema = trimmedString(40, 5000);
const speakerRoleSchema = z.enum(["proposer", "speaker", "co_speaker", "moderator", "panelist"]);

export const participantProfileSchema = userProfileSchema.extend({
  bio: speakerBioSchema,
  links: linksSchema.default([]),
});

/**
 * Profile schema for the proposal contact/proposer.
 * Bio is optional — the proposer may be a non-presenting contact.
 * If the proposer is also presenting, their bio is captured here and stored
 * on their user record; they appear in proposal_speakers with role "proposer".
 */
export const proposerProfileSchema = userProfileSchema.extend({
  bio: speakerBioSchema.optional(),
  links: linksSchema.default([]),
});

export const inviteeSchema = z.object({
  email: normalizedEmailSchema,
  firstName: firstNameSchema.optional(),
  lastName: lastNameSchema.optional(),
});

export const registrationCreateSchema = z.object({
  firstName: firstNameSchema,
  lastName: lastNameSchema,
  email: normalizedEmailSchema,
  organizationName: organizationNameSchema.optional(),
  jobTitle: jobTitleSchema.optional(),
  attendanceType: attendanceTypeSchema.optional(),
  dayAttendance: z.array(dayAttendanceItemSchema).max(31).optional(),
  sourceType: sourceTypeSchema.catch("direct").default("direct"),
  sourceRef: trimmedString(2, 200).optional(),
  customAnswers: customAnswersSchema.optional(),
  inviteToken: tokenSchema.optional(),
  referralCode: z.string().trim().regex(/^[A-Za-z0-9]{6,12}$/).optional(),
  consents: z.array(consentItemSchema).min(1).max(20),
}).superRefine((value, ctx) => {
  if (!value.attendanceType && (!value.dayAttendance || value.dayAttendance.length === 0)) {
    ctx.addIssue({
      code: "custom",
      path: ["attendanceType"],
      message: "attendanceType or dayAttendance is required",
    });
  }
});

export const registrationConfirmSchema = z.object({
  token: tokenSchema,
});

export const registrationManageSchema = z.object({
  action: z.enum(["update", "cancel", "report_unauthorized"]),
  attendanceType: attendanceTypeSchema.optional(),
  dayAttendance: z.array(dayAttendanceItemSchema).max(31).optional(),
  customAnswers: customAnswersSchema.optional(),
  sourceRef: trimmedString(2, 200).optional(),
  // PII fields — only used with action "update"
  firstName: firstNameSchema.optional(),
  lastName: lastNameSchema.optional(),
  organizationName: organizationNameSchema.optional(),
  jobTitle: jobTitleSchema.optional(),
});

export const registrationInviteCreateSchema = z.object({
  invites: z.array(inviteeSchema).min(1).max(10),
});

export const inviteDeclineSchema = z
  .object({
    reasonCode: declineReasonCodeSchema,
    reasonNote: trimmedString(3, 2000).optional(),
    unsubscribeFuture: z.boolean().optional(),
    npsScore: z.number().int().min(1).max(10).optional(),
    forwards: z.array(inviteeSchema).max(5).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reasonCode === "other" && !value.reasonNote) {
      ctx.addIssue({
        code: "custom",
        path: ["reasonNote"],
        message: "reasonNote is required when reasonCode is 'other'",
      });
    }
  });

export const inviteAcceptAttendeeSchema = z.object({
  firstName: firstNameSchema,
  lastName: lastNameSchema,
  email: normalizedEmailSchema,
  organizationName: organizationNameSchema.optional(),
  jobTitle: jobTitleSchema.optional(),
  attendanceType: attendanceTypeSchema.optional(),
  dayAttendance: z.array(dayAttendanceItemSchema).max(31).optional(),
  customAnswers: customAnswersSchema.optional(),
  consents: z.array(consentItemSchema).min(1).max(20),
}).superRefine((value, ctx) => {
  if (!value.attendanceType && (!value.dayAttendance || value.dayAttendance.length === 0)) {
    ctx.addIssue({
      code: "custom",
      path: ["attendanceType"],
      message: "attendanceType or dayAttendance is required",
    });
  }
});

export const proposalTypeSchema = z.enum([
  "keynote",
  "talk",
  "workshop",
  "panel",
  "tutorial",
  "lightning_talk",
  "roundtable",
  "birds_of_a_feather",
  "fireside_chat",
  "demo",
]);

const proposalTitleSchema = trimmedString(8, 180);
const proposalAbstractSchema = trimmedString(80, 8000);

export const proposalCreateSchema = boundedJsonObject(
  {
    inviteToken: tokenSchema.optional(),
    sourceType: sourceTypeSchema.catch("direct").default("direct"),
    sourceRef: trimmedString(2, 200).optional(),
    referralCode: z.string().trim().regex(/^[A-Za-z0-9]{6,12}$/).optional(),
    proposer: proposerProfileSchema,
    proposal: z.object({
      type: proposalTypeSchema,
      title: proposalTitleSchema,
      abstract: proposalAbstractSchema,
      details: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
    }),
    speakers: z
      .array(
        participantProfileSchema.extend({
          role: speakerRoleSchema.default("speaker"),
        }),
      )
      .max(8)
      .default([]),
    consents: z.array(consentItemSchema).min(1).max(20),
  },
  40_000,
).superRefine((value, ctx) => {
  if (value.proposal.type === "panel") {
    const panelParticipants = value.speakers.filter((speaker) => speaker.role === "panelist");
    if (panelParticipants.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["speakers"],
        message: "Panel proposals require at least one speaker with role 'panelist'",
      });
    }
  }
});

export const proposalManageSchema = boundedJsonObject(
  {
    action: z.enum(["update", "withdraw"]),
    proposalType: proposalTypeSchema.optional(),
    title: proposalTitleSchema.optional(),
    abstract: proposalAbstractSchema.optional(),
    details: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
  },
  30_000,
);

export const reviewUpsertSchema = z.object({
  recommendation: z.enum(["accept", "reject", "needs-work"]),
  score: z.number().int().min(1).max(10).optional(),
  reviewerComment: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    trimmedString(3, 10_000).optional(),
  ),
  applicantNote: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    trimmedString(3, 10_000).optional(),
  ),
});

export const reviewPatchSchema = z.object({
  recommendation: z.enum(["accept", "reject", "needs-work"]).optional(),
  score: z.number().int().min(1).max(10).nullable().optional(),
  reviewerComment: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    trimmedString(3, 10_000).nullable().optional(),
  ),
  applicantNote: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    trimmedString(3, 10_000).nullable().optional(),
  ),
});

export const finalizeProposalSchema = z.object({
  finalStatus: z.enum(["accepted", "rejected", "needs_work"]),
  decisionNote: trimmedString(3, 10_000).optional(),
  /** ISO-8601 date by which speakers must upload their presentation slides. */
  presentationDeadline: z.string().datetime().optional(),
});

export const adminEmailTemplateVersionSchema = z.object({
  content: z.string().min(1).max(500_000),
  subjectTemplate: z.string().trim().min(1).max(512).optional(),
  contentType: z.enum(["markdown", "html", "text"]).optional(),
});

export const adminEmailTemplateActivateSchema = z.object({
  version: z.number().int().positive(),
});

export const adminEmailTemplatePreviewSchema = z.object({
  subjectTemplate: z.string().trim().min(1).max(512).optional(),
  content: z.string().min(1).max(500_000),
  contentType: z.enum(["markdown", "html", "text"]).default("markdown"),
  data: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
});

export const adminAuthRequestSchema = z.object({
  email: normalizedEmailSchema,
});

export const adminAuthVerifySchema = z.object({
  token: tokenSchema,
});

export const adminRetryOutboxSchema = z.object({
  limit: z.number().int().positive().max(100).default(20),
});

export const adminResetFailedOutboxSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
});

export const adminRunRemindersSchema = z.object({
  limit: z.number().int().positive().max(500).default(200),
  dryRun: z.boolean().default(false),
});

export const adminRunJobsSchema = z.object({
  reminderLimit: z.number().int().positive().max(500).default(120),
  outboxLimit: z.number().int().positive().max(500).default(120),
  runReminders: z.boolean().default(true),
  runRetention: z.boolean().default(true),
  runOutbox: z.boolean().default(true),
  runRetentionMode: z.enum(["always", "daily_window"]).default("always"),
  retentionHourUtc: z.number().int().min(0).max(23).default(3),
  dryRun: z.boolean().default(false),
});

export const inviteReminderPreferenceSchema = z.object({
  action: z.enum(["postpone_7d", "pause_30d", "resume", "unsubscribe"]),
});

export const speakerReminderPreferenceSchema = z.object({
  action: z.enum(["postpone_7d", "pause_30d", "resume"]),
});

const termSchema = z.object({
  termKey: z.string().trim().regex(termKeyPattern),
  version: z.string().trim().regex(versionPattern),
  required: z.boolean().optional(),
  contentRef: trimmedString(1, 500).optional(),
  displayText: trimmedString(3, 4000).optional(),
});

const frontendRoutesSchema = z.object({
  registration: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  registrationConfirm: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  proposal: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  registrationManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  proposalManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  speakerManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
});

export const adminEventSyncSchema = z.object({
  event: z.object({
    slug: z.string().trim().regex(slugPattern),
    name: trimmedString(3, 180),
    timezone: trimmedString(2, 64),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).optional(),
    inviteLimitAttendee: z.number().int().positive().max(50).optional(),
    frontend: z.object({ routes: frontendRoutesSchema }).optional(),
    settings: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
  }),
  terms: z
    .object({
      attendee: z.array(termSchema).max(40).default([]),
      speaker: z.array(termSchema).max(40).default([]),
    })
    .optional(),
});

export const adminEventSettingsSchema = z.object({
  // ── Core event details ─────────────────────────────────────────────────────
  name: trimmedString(3, 180).optional(),
  timezone: trimmedString(2, 64).optional(),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  venue: trimmedString(2, 500).nullable().optional(),
  virtualUrl: z.string().trim().url().max(500).nullable().optional(),
  heroImageUrl: trimmedString(2, 500).nullable().optional(),
  location: trimmedString(2, 200).nullable().optional(),
  // ── Proposal / session settings ────────────────────────────────────────────
  sessionTypes: z.array(z.string().trim().min(1).max(80)).max(20).nullable().optional(),
  // ── Registration settings ──────────────────────────────────────────────────
  registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).optional(),
  inviteLimitAttendee: z.number().int().positive().max(50).optional(),
  settings: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
  userRetentionDays: z.number().int().positive().max(3650).optional(),
});

// ── Admin: event terms management ─────────────────────────────────────────────

export const adminEventTermInputSchema = z.object({
  termKey: z.string().trim().regex(termKeyPattern),
  version: z.string().trim().regex(versionPattern),
  required: z.boolean().default(true),
  contentRef: trimmedString(1, 500).optional(),
  displayText: trimmedString(3, 4000),
  helpText: trimmedString(3, 2000).optional(),
});

export const adminEventTermsReplaceSchema = z.object({
  attendee: z.array(adminEventTermInputSchema).max(40).default([]),
  speaker: z.array(adminEventTermInputSchema).max(40).default([]),
});

// ── Admin: event days management ──────────────────────────────────────────────

export const adminAttendanceOptionSchema = z.object({
  value: z.string().trim().min(1).max(64).regex(/^[a-z_][a-z0-9_]*$/),
  label: trimmedString(1, 80),
  capacity: z.number().int().positive().nullable().optional(),
});

export const adminEventDayInputSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: trimmedString(1, 200).optional(),
  startTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  endTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  attendanceOptions: z.array(adminAttendanceOptionSchema).max(20).default([]),
});

export const adminEventDaysReplaceSchema = z.object({
  days: z.array(adminEventDayInputSchema).max(31),
});

// ── Admin: forms management ───────────────────────────────────────────────────

export const adminFormFieldInputSchema = z.object({
  key: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/),
  label: trimmedString(1, 200),
  fieldType: z.enum(["text", "textarea", "select", "multi_select", "boolean", "number", "date", "email", "url"]),
  required: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  options: z.array(z.string().trim().min(1).max(500)).max(200).optional(),
  validation: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
});

export const adminFormCreateSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9-]*$/),
  purpose: z.enum(["event_registration", "proposal_submission", "survey", "feedback", "application"]),
  title: trimmedString(2, 200),
  description: trimmedString(2, 1000).optional(),
  status: z.enum(["active", "inactive", "archived"]).default("active"),
  fields: z.array(adminFormFieldInputSchema).max(50).default([]),
});

export const adminFormUpdateSchema = z.object({
  title: trimmedString(2, 200).optional(),
  description: trimmedString(2, 1000).nullable().optional(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
  fields: z.array(adminFormFieldInputSchema).max(50).optional(),
});

export const adminCreateEventSchema = z.object({
  slug: z.string().trim().regex(slugPattern),
  name: trimmedString(3, 180),
  timezone: trimmedString(2, 64).default("UTC"),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).default("invite_or_open"),
  inviteLimitAttendee: z.number().int().positive().max(50).default(5),
  venue: trimmedString(2, 500).nullable().optional(),
  virtualUrl: z.string().trim().url().max(500).nullable().optional(),
});

export const adminEventPermissionSchema = z.object({
  userEmail: normalizedEmailSchema,
  permission: z.enum(["organizer", "program_committee", "moderator", "volunteer"]),
});

export const adminUserRoleSchema = z.object({
  role: z.enum(["admin", "user", "guest"]),
});

/** PATCH body for updating a user's role and/or active status. */
export const adminUserUpdateSchema = z
  .object({
    role: z.enum(["admin", "user", "guest"]).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.active !== undefined, {
    message: "At least one of 'role' or 'active' must be provided",
  });

/** POST /anonymize — no body required; confirmation is implicit in calling the endpoint. */
export const adminUserAnonymizeSchema = z.object({}).strict();

export const adminBulkAttendeeInvitesSchema = z.object({
  previewToken: z.string().trim().min(16).max(2048),
  invites: z
    .array(
      inviteeSchema.extend({
        sourceType: sourceTypeSchema.optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const adminBulkAttendeeInvitesPreviewSchema = z.object({
  invites: z
    .array(
      inviteeSchema.extend({
        sourceType: sourceTypeSchema.optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const adminBulkSpeakerInvitesSchema = z.object({
  invites: z
    .array(
      inviteeSchema.extend({
        sourceType: sourceTypeSchema.optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const adminRegistrationAdmitSchema = z.object({
  mode: z.enum(["vip", "capacity_exempt"]).default("vip"),
  reason: trimmedString(3, 1000),
  dayDates: z.array(dayDateSchema).min(1).max(31).optional(),
});

// ── Admin: campaign emails ────────────────────────────────────────────────────

const campaignFilterSchema = z.object({
  audience: z.enum(["attendees", "speakers"]),
  attendeeStatus: z.enum(["all", "registered", "pending_email_confirmation", "waitlisted", "cancelled"]).optional(),
  attendanceType: z.enum(["all", "in_person", "virtual", "on_demand"]).optional(),
  dayDate: z.string().trim().max(20).optional(),
  speakerStatus: z.enum(["all", "confirmed", "invited", "pending"]).optional(),
});

const campaignBaseSchema = z.object({
  templateKey: z.string().trim().min(1).max(200).optional(),
  subjectOverride: z.string().trim().min(1).max(500).optional(),
  customText: z.string().trim().max(100_000).optional(),
  bodyContent: z.string().trim().max(100_000).optional(),
  sendMode: z.enum(["personal", "bcc_batch"]),
  batchSize: z.number().int().min(1).max(500).default(50),
  filter: campaignFilterSchema,
});

export const adminEventCampaignPreviewSchema = campaignBaseSchema;

export const adminEventCampaignSendSchema = campaignBaseSchema.extend({
  previewToken: z.string().trim().min(16).max(2048),
});

export type AdminEventSyncInput = z.infer<typeof adminEventSyncSchema>;
export type EventFormsPurpose = "event_registration" | "proposal_submission";

export interface EventFormsResponse {
  event: {
    id: string;
    slug: string;
    name: string;
  };
  purpose: EventFormsPurpose;
  form: {
    id: string;
    key: string;
    title: string;
    description: string | null;
    fields: Array<{
      key: string;
      label: string;
      fieldType: string;
      required: boolean;
      options: Array<string | { value: string; label?: string }>;
      validation: Record<string, unknown>;
      sortOrder: number;
    }>;
  } | null;
  requiredTerms: Array<{
    termKey: string;
    version: string;
    required: boolean;
    contentRef: string | null;
    displayText?: string | null;
  }>;
  eventDays: Array<{
    dayDate: string;
    label: string | null;
    inPersonCapacity: number | null;
    sortOrder: number;
  }>;
}

export interface RegistrationManageReadResponse {
  success: true;
  registration: Record<string, unknown>;
  event: {
    id: string;
    slug: string;
    name: string;
  } | null;
  user: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
  } | null;
  eventDays: Array<{
    dayDate: string;
    label: string | null;
    inPersonCapacity: number | null;
    sortOrder: number;
  }>;
  dayAttendance: Array<{
    dayDate: string;
    attendanceType: string;
    label: string | null;
  }>;
  dayWaitlist: Array<{
    dayDate: string;
    status: "waiting" | "offered" | "accepted";
    priorityLane: "continuity" | "general";
    offerExpiresAt: string | null;
  }>;
}

export interface ProposalManageReadResponse {
  success: true;
  proposal: Record<string, unknown> & {
    details: Record<string, unknown> | null;
  };
  speakers: Array<{
    userId: string;
    role: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    organizationName: string | null;
    jobTitle: string | null;
    bio: string | null;
    links: string[];
  }>;
}
