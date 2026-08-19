import { z } from "zod";
import { defaultedSourceTypeSchema, sourceTypeSchema } from "./source";
import { linksSchema } from "./links";
import { paginationQuerySchema, paginatedResponseSchema, sortColumnSchema } from "./pagination";
import { emailContentTypeSchema, emailMessageTypeSchema } from "./admin-email-templates";

export { sourceTypeSchema };

const namePattern = /^[\p{L}\p{N} .,'’\-()&/]+$/u;
const slugPattern = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
const termKeyPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const tokenPattern = /^[A-Za-z0-9_.-]{16,512}$/;
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

export const normalizedEmailSchema = z
  .email({ error: "Please enter a valid email address (for example: name@example.com)." })
  .transform((value) => value.trim().toLowerCase());
export const firstNameSchema = trimmedString(1, 80).regex(namePattern, "Contains unsupported characters");
export const lastNameSchema = trimmedString(1, 120).regex(namePattern, "Contains unsupported characters");
export const organizationNameSchema = trimmedString(2, 160);
export const jobTitleSchema = trimmedString(2, 120);
export const tokenSchema = z.string().trim().regex(tokenPattern, "Invalid token format");

export const eventSlugParamsSchema = z.object({
  eventSlug: z.string().trim().regex(slugPattern),
});

export const proposalIdParamsSchema = z.object({
  proposalId: z.uuid(),
});

export const proposalReviewIdParamsSchema = proposalIdParamsSchema.extend({
  reviewId: z.uuid(),
});

export const formKeyParamsSchema = z.object({
  formKey: z.string().trim().min(1).max(120),
});

export const adminUserIdParamsSchema = z.object({
  userId: z.uuid(),
});

export const emailTemplateKeyParamsSchema = z.object({
  key: z.string().trim().min(1).max(200),
});

export const registrationManageTokenParamsSchema = z.object({
  token: z.string().trim().min(1).max(4096).describe("Attendee self-service registration manage token"),
});

export const adminEmailOutboxQuerySchema = z.object({
  status: z.string().trim().optional(),
  messageType: emailMessageTypeSchema.optional(),
  dueNow: z.coerce.boolean().optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const adminEventProposalsQuerySchema = paginationQuerySchema.extend({
  status: z.string().trim().optional(),
  recommendation: z.enum(["accept", "reject", "needs-work"]).optional(),
  // Not the bare-column `sortColumnSchema` convention used elsewhere — each
  // of these values resolves to a multi-column ORDER BY (e.g. score_desc
  // sorts NULLs-last, then submitted_at as a tiebreaker), which a single
  // allowlisted column name can't express. See orderByMap in
  // functions/api/v1/admin/events/[eventSlug]/proposals.ts.
  sort: z
    .enum([
      "submitted_desc",
      "submitted_asc",
      "score_desc",
      "score_asc",
      "reviews_desc",
      "reviews_asc",
      "title_desc",
      "title_asc",
      "proposer_desc",
      "proposer_asc",
      "type_desc",
      "type_asc",
      "status_desc",
      "status_asc",
      "decision_desc",
      "decision_asc",
      "recommendations_desc",
      "recommendations_asc",
    ])
    .optional(),
  q: z.string().trim().optional(),
  search: z.string().trim().optional(),
  // "1" shows the soft-deleted queue instead of live proposals; any other
  // value (including omitted) keeps the default live view.
  deleted: z.string().trim().optional(),
});

// ── `?sort=` allowlists for admin event-scoped list endpoints (B5) ─────────
// Same `resolveOrderBy`-compatible convention as admin-organizations.ts's
// `organizationsSortValueSchema`: a bare column name for ASC, `-column` for
// DESC. An unrecognized value fails validation and callers fall back to the
// endpoint's default order (see functions/_lib/db/sort.ts).

/** Allowlisted sort columns for GET /api/v1/admin/events — see functions/api/v1/admin/events.ts. */
export const EVENTS_LIST_SORT_COLUMNS = ["name", "starts_at", "registration_mode", "total_registrations"] as const;
export const eventsListSortValueSchema = sortColumnSchema(EVENTS_LIST_SORT_COLUMNS);

export const adminEventsListQuerySchema = paginationQuerySchema.extend({
  sort: eventsListSortValueSchema,
});

/** Allowlisted sort columns for GET /api/v1/admin/events/:eventSlug/permissions (Team) — see functions/api/v1/admin/events/[eventSlug]/permissions.ts. */
// `created_at` is table-qualified (`ur.`) for the same reason as
// EVENT_INVITES_SORT_COLUMNS above — the route joins `users`, which also has
// its own `created_at`.
export const EVENT_TEAM_SORT_COLUMNS = ["user_email", "role_id", "ur.created_at", "expires_at"] as const;
export const eventTeamSortValueSchema = sortColumnSchema(EVENT_TEAM_SORT_COLUMNS);

export const adminEventTeamListQuerySchema = paginationQuerySchema.extend({
  sort: eventTeamSortValueSchema,
});

/**
 * Allowlisted sort columns for GET /api/v1/admin/events/:eventSlug/registrations
 * — see functions/_lib/services/registrations/admin-list.ts. Unlike the
 * other `*SortValueSchema` allowlists above, this one isn't wrapped in a
 * strict refine()-validated schema: an invalid `?sort=` value here falls
 * back to the default order via resolveOrderBy rather than a 400, matching
 * this endpoint's pre-existing tolerant behavior for its other filters.
 */
export const EVENT_REGISTRATIONS_SORT_COLUMNS = ["display_name", "status", "attendance_type", "created_at"] as const;

// status/bounced/consent/attendance_change/sort intentionally accept any
// string here and are validated leniently in listAdminEventRegistrations /
// resolveOrderBy (an unrecognized value is treated as "no filter" / "default
// order", not a 400) — the pre-Phase-6 route had this exact "quietly ignore
// an unknown value" behavior for all of them (see
// tests/admin-event-management.test.ts's "?attendance_change=unexpected"
// coverage), so real enum/refine validation here would be a behavior
// change, not a refactor.
export const adminEventRegistrationsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().optional(),
  bounced: z.string().trim().optional(),
  consent: z.string().trim().optional(),
  attendance_change: z.string().trim().optional(),
  sort: z.string().trim().max(41).optional(),
});

/** Allowlisted sort columns for GET /api/v1/admin/events/:eventSlug/invites — see functions/api/v1/admin/events/[eventSlug]/invites/index.ts. */
// `created_at` is table-qualified (`i.`) because the route joins `users`,
// which also has its own `created_at` — an unqualified ORDER BY created_at
// is ambiguous and 500s (discovered by this pass's own pagination test;
// pre-existing, not previously exercised by any test).
export const EVENT_INVITES_SORT_COLUMNS = ["invitee_email", "status", "i.created_at", "accepted_at"] as const;
export const eventInvitesSortValueSchema = sortColumnSchema(EVENT_INVITES_SORT_COLUMNS);

// P6M-P2-05: `status`/`type` are validated leniently (an unrecognized value
// is treated as "no filter", matching the pre-existing handler's own
// `validStatuses.has(...)`/`validTypes.has(...)` tolerant behavior) rather
// than a strict enum that would 400 — same "enforced-but-non-strict"
// convention as adminEventRegistrationsQuerySchema.
export const adminEventInvitesListQuerySchema = paginationQuerySchema.extend({
  status: z.string().trim().max(20).optional(),
  type: z.string().trim().max(20).optional(),
  q: z.string().trim().max(200).optional(),
  sort: eventInvitesSortValueSchema,
});

/**
 * Allowlisted sort columns for GET /api/v1/admin/forms/:formKey/submissions
 * (FormResponses) — see functions/_lib/services/form-submissions.ts. That
 * endpoint merges rows from three tables (form_submissions plus synthetic
 * registrations/proposals rows) via a single `UNION ALL` SQL query (a
 * `merged` CTE) rather than fetching each source unbounded and reconciling
 * in JS, so these columns are the `merged` CTE's own output column names
 * and drive `resolveOrderBy` like any other list endpoint — the
 * "-column"/"column" convention is kept identical so the frontend Column
 * `sort` config works the same way as everywhere else.
 */
export const FORM_SUBMISSIONS_SORT_COLUMNS = ["submitter", "status", "submitted_at"] as const;
export const formSubmissionsSortValueSchema = sortColumnSchema(FORM_SUBMISSIONS_SORT_COLUMNS);

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

export const successResponseSchema = z.object({
  success: z.boolean(),
});

export const registrationHeadshotUploadRouteSchema = {
  tags: ["Registrations", "Headshots"],
  summary: "Upload or replace registration headshot",
  description:
    "Uploads or replaces the attendee's profile headshot image which is dynamically rendered in social badge images. Requires a valid registration management token as path parameter.",
  request: {
    params: registrationManageTokenParamsSchema,
    body: {
      content: {
        "multipart/form-data": {
          schema: registrationHeadshotUploadFormSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Headshot image uploaded and processed successfully.",
      content: {
        "application/json": {
          schema: registrationHeadshotUploadResponseSchema,
        },
      },
    },
    "400": {
      description: "Invalid request payload format, or file parameter is missing.",
    },
    "413": {
      description: "Uploaded file exceeds the maximum allowed size.",
    },
    "503": {
      description: "R2 upload buckets are not configured/reachable.",
    },
  },
};

export const registrationHeadshotDeleteRouteSchema = {
  tags: ["Registrations", "Headshots"],
  summary: "Delete registration headshot",
  description:
    "Deletes the attendee's profile headshot image from active storage and clears references. Requires a valid registration management token.",
  request: {
    params: registrationManageTokenParamsSchema,
  },
  responses: {
    "200": {
      description: "Headshot removed successfully.",
      content: {
        "application/json": {
          schema: successResponseSchema,
        },
      },
    },
    "404": {
      description: "User details matching parent token were not found.",
    },
  },
};

export const adminHeadshotUploadResponseSchema = z.object({
  success: z.boolean(),
  r2Key: z.string().describe("R2 object key for the uploaded headshot"),
});

export const attendanceTypeSchema = z.enum(["in_person", "virtual", "on_demand"]);
// dayAttendanceTypeSchema accepts any non-empty string because attendance options
// are now configurable per event day (e.g. 'in_person', 'on_demand', 'virtual').
// Application-layer validation in enforceDayCapacity checks the value against
// the event's configured options.
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

const dayDateSchema = z
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
  .object({
    start: dayDateSchema,
    end: dayDateSchema,
  })
  .superRefine((value, ctx) => {
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
  role: speakerRoleSchema.default("proposer"),
});

export const inviteeSchema = z.object({
  email: normalizedEmailSchema,
  firstName: firstNameSchema.optional(),
  lastName: lastNameSchema.optional(),
});

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
  .superRefine((value, ctx) => {
    if (!value.attendanceType && (!value.dayAttendance || value.dayAttendance.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["attendanceType"],
        message: "attendanceType or dayAttendance is required",
      });
    }
  });

export const registrationConfirmSchema = z.object({
  id: z.uuid().optional(),
  token: tokenSchema,
});

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
  .refine((value) => Boolean(value.token || value.email), {
    message: "token or email is required",
  });

export const okResponseSchema = z.object({
  ok: z.boolean(),
});

export const registrationManageSchema = z.object({
  action: z.enum(["update", "cancel", "report_unauthorized"]),
  attendanceType: attendanceTypeSchema.optional(),
  dayAttendance: z.array(dayAttendanceItemSchema).max(31).optional(),
  customAnswers: customAnswersSchema.optional(),
  sourceRef: trimmedString(2, 200).optional(),
  // PII fields — only used with action "update"
  email: normalizedEmailSchema.optional(),
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
  .superRefine((value, ctx) => {
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
    inviteId: z.uuid().optional(),
    sourceType: defaultedSourceTypeSchema,
    sourceRef: trimmedString(2, 200).optional(),
    referralCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6,12}$/)
      .optional(),
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

export const proposalCreateResponseSchema = z.object({
  success: z.boolean(),
  proposalId: z.uuid(),
  status: z.string(),
  manageToken: z.string(),
  manageUrl: z.string().url(),
  shareUrl: z.string().url(),
});

export const proposalResendManageLinkSchema = z.object({
  email: normalizedEmailSchema,
});

export const proposalResendSpeakerManageLinkSchema = proposalResendManageLinkSchema;

export const inviteResendLinkSchema = z.object({
  email: normalizedEmailSchema,
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
  score: z.number().int().min(1).max(10),
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
  finalStatus: z.enum(["accepted", "rejected", "needs-work"]),
  decisionNote: trimmedString(3, 10_000).optional(),
  /** ISO-8601 date by which speakers must upload their presentation slides. */
  presentationDeadline: z.iso.datetime().optional(),
});

export const adminProposalPatchSchema = z.object({
  title: proposalTitleSchema.optional(),
  abstract: proposalAbstractSchema.optional(),
});

export const adminSpeakerBioPatchSchema = z.object({
  role: speakerRoleSchema.optional(),
  firstName: z.string().trim().max(80).nullable().optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
  organizationName: z.string().trim().max(200).nullable().optional(),
  jobTitle: z.string().trim().max(200).nullable().optional(),
  biography: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(5000).nullable().optional(),
  ),
  links: linksSchema.nullable().optional(),
});

export const adminEmailTemplateVersionSchema = z.object({
  content: z.string().min(1).max(500_000),
  subjectTemplate: z.string().trim().min(1).max(512).optional(),
  contentType: emailContentTypeSchema.optional(),
  messageType: emailMessageTypeSchema.optional(),
});

export const adminEmailTemplateActivateSchema = z.object({
  version: z.number().int().positive(),
});

export const adminEmailTemplatePreviewSchema = z.object({
  subjectTemplate: z.string().trim().min(1).max(512).optional(),
  content: z.string().min(1).max(500_000),
  contentType: emailContentTypeSchema.default("markdown"),
  layoutHtml: z.string().min(1).max(500_000).optional(),
  data: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
});

export const adminAuthRequestSchema = z.object({
  email: normalizedEmailSchema,
});

export const adminAuthVerifySchema = z.object({
  token: tokenSchema,
});

export const adminRetryOutboxSchema = z.object({
  limit: z.number().int().positive().max(500).default(20),
  ids: z.array(z.uuid()).max(100).optional(),
});

export const adminResetFailedOutboxSchema = z.object({
  ids: z.array(z.uuid()).max(100).optional(),
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
  // Manual off-cycle triggers for the twice-weekly membership batches
  // normally cron-fired (functions/router.ts), these flags let
  // staff run them on demand from the Due Work screen. Unlike the flags
  // above, these have no meaningful dry-run preview (they queue a real
  // outbox email to a mailing list / transition applications), so `dryRun`
  // is ignored for both and they only ever run when explicitly requested.
  runConsultationBatch: z.boolean().default(false),
  runEcReviewBatch: z.boolean().default(false),
  // Manual off-cycle trigger for the weekly WG chair membership-change
  // digest (2026-07-31 manual-testing feedback) — normally cron-fired
  // Mondays 08:00 UTC (functions/router.ts). Same no-dry-run-preview
  // rationale as the two flags above.
  runWgChairDigest: z.boolean().default(false),
});

export const internalCalendarRsvpIngestSchema = z
  .object({
    provider: z.string().trim().min(2).max(80).default("cloudflare_email_route"),
    sourceMessageId: z.string().trim().min(1).max(500).optional(),
    receivedAt: z.iso.datetime().optional(),
    fromEmail: normalizedEmailSchema.optional(),
    toEmail: normalizedEmailSchema.optional(),
    subject: z.string().trim().min(1).max(500).optional(),
    uid: z.string().trim().min(1).max(500).optional(),
    partstat: z.string().trim().min(1).max(64).optional(),
    attendeeEmail: normalizedEmailSchema.optional(),
    method: z.string().trim().min(1).max(40).optional(),
    sequence: z.number().int().min(0).max(100_000).optional(),
    calendarIcs: z.string().min(1).max(300_000).optional(),
    rawPayload: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    const hasDirectRsvp = Boolean(value.uid && value.partstat);
    if (!hasDirectRsvp && !value.calendarIcs) {
      ctx.addIssue({
        code: "custom",
        message: "Either uid+partstat or calendarIcs is required",
        path: ["uid"],
      });
    }
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
  sessionTypes: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        requiresPresentation: z.boolean(),
      }),
    )
    .max(20)
    .nullable()
    .optional(),
  registrationFormKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9-]*$/)
    .nullable()
    .optional(),
  proposalFormKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9-]*$/)
    .nullable()
    .optional(),
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
  presentation: z.array(adminEventTermInputSchema).max(40).default([]),
});

// ── Admin: event days management ──────────────────────────────────────────────

export const adminAttendanceOptionSchema = z.object({
  value: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z_][a-z0-9_]*$/),
  label: trimmedString(1, 80),
  capacity: z.number().int().positive().nullable().optional(),
});

export const adminEventDayInputSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  label: trimmedString(1, 200).optional(),
  startTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  endTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  attendanceOptions: z.array(adminAttendanceOptionSchema).max(20).default([]),
});

export const adminEventDaysReplaceSchema = z.object({
  days: z.array(adminEventDayInputSchema).max(31),
});

// ── Admin: forms management ───────────────────────────────────────────────────

export const adminFormFieldInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: trimmedString(1, 200),
  fieldType: z.enum(["text", "textarea", "select", "multi_select", "boolean", "number", "date", "email", "url"]),
  required: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  options: z.array(z.string().trim().min(1).max(500)).max(200).optional(),
  validation: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
});

export const adminFormCreateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9-]*$/),
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

// GET /api/v1/admin/forms (P6M-P2-14) — dataset is inherently small (one row
// per configured form), but still composes the shared pagination contract
// rather than returning every row unbounded, for the same reason every other
// list endpoint does: a fixed, predictable upper bound on rows materialized
// per request.
export const adminFormsListQuerySchema = paginationQuerySchema;

export const adminFormSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  scope_type: z.string(),
  scope_ref: z.string().nullable(),
  event_slug: z.string().nullable(),
  event_name: z.string().nullable(),
  purpose: z.string(),
  status: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  field_count: z.number(),
  submission_count: z.number(),
});

export const adminFormsListResponseSchema = paginatedResponseSchema("forms", adminFormSummarySchema);

// GET /api/v1/admin/forms/:formKey/submissions (P6M-P1-03) — see
// functions/_lib/services/form-submissions.ts for the bounded `merged` CTE
// this schema drives.
export const adminFormSubmissionsQuerySchema = paginationQuerySchema.extend({
  // The admin Statistics tab (FormResponses.tsx) requests `limit=0` as a
  // "stats only, no submission rows" sentinel, so — unlike every other list
  // endpoint — 0 must stay a valid limit here rather than requiring >= 1.
  limit: z.coerce.number().int().min(0).max(500).optional(),
  status: z.string().trim().max(50).optional(),
  attendanceType: z.string().trim().max(50).optional(),
  eventSlug: z.string().trim().min(1).max(200).optional(),
  sort: formSubmissionsSortValueSchema,
});

export const adminFormSubmissionSubmitterSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  organization: z.string().nullable(),
});

export const adminFormSubmissionSchema = z.object({
  id: z.string(),
  status: z.string(),
  submittedAt: z.string(),
  contextType: z.string().nullable(),
  contextRef: z.string().nullable(),
  submitter: adminFormSubmissionSubmitterSchema.nullable(),
  answers: z.record(z.string(), z.unknown()),
});

export const adminFormSubmissionStatEntrySchema = z.object({
  label: z.string(),
  count: z.number(),
  percent: z.number(),
  weight: z.number(),
});

export const adminFormSubmissionStatSchema = z.object({
  fieldKey: z.string(),
  totalAnswers: z.number(),
  uniqueAnswers: z.number(),
  entries: z.array(adminFormSubmissionStatEntrySchema),
});

export const adminFormSubmissionsResponseSchema = paginatedResponseSchema(
  "submissions",
  adminFormSubmissionSchema,
).extend({
  form: z.object({ id: z.string(), key: z.string(), title: z.string(), purpose: z.string() }),
  // Kept alongside `page` (duplicating page.total/limit/offset) since the
  // admin Statistics tab already reads these top-level fields directly —
  // changing the envelope shape is out of scope for the bounded-query fix.
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  stats: z.array(adminFormSubmissionStatSchema),
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

/** Event-team permission grant. Canonical vocabulary — see AGENTS.md DRY policy (mirrors the `event_permissions.permission` CHECK constraint). */
export const eventTeamPermissionSchema = z.enum(["organizer", "program_committee", "moderator", "volunteer"]);
export type EventTeamPermission = z.infer<typeof eventTeamPermissionSchema>;

export const adminEventPermissionSchema = z.object({
  userEmail: normalizedEmailSchema,
  permission: eventTeamPermissionSchema,
  //Grant time-bounded event reviewer access from the event detail screen.
  expiresAt: z.iso.datetime().nullable().optional(),
});

/** Staff account role. Canonical vocabulary — see AGENTS.md DRY policy (mirrors the `users.role` CHECK constraint). */
export const adminRoleValueSchema = z.enum(["admin", "user", "guest"]);
export type AdminRoleValue = z.infer<typeof adminRoleValueSchema>;

export const adminUserRoleSchema = z.object({
  role: adminRoleValueSchema,
});

/** PATCH body for updating a user's role, active status, email, and/or PII fields. */
export const adminUserUpdateSchema = z
  .object({
    role: adminRoleValueSchema.optional(),
    active: z.boolean().optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    firstName: z.string().trim().max(80).nullable().optional(),
    lastName: z.string().trim().max(120).nullable().optional(),
    preferredName: z.string().trim().max(80).nullable().optional(),
    organizationName: z.string().trim().max(200).nullable().optional(),
    jobTitle: z.string().trim().max(200).nullable().optional(),
    biography: z.string().trim().max(5000).nullable().optional(),
    links: linksSchema.nullable().optional(),
    /** users.is_ec_member (migration 0038) — pure designation, no permission bundle. */
    isEcMember: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field must be provided",
  });

/** POST /anonymize — no body required; confirmation is implicit in calling the endpoint. */
export const adminUserAnonymizeSchema = z.object({}).strict();

// Names in admin-uploaded CSVs may contain any Unicode characters (including
// characters from non-UTF-8 encoded files, unusual punctuation, etc.).  We
// only enforce a length bound here — rendering templates HTML-escape the values.
const bulkInviteNameSchema = (max: number) => z.string().trim().min(1).max(max).optional();

export const adminBulkAttendeeInvitesSchema = z.object({
  previewToken: z.string().trim().min(16).max(2048),
  /** When sending a large list in chunks, pass the digest of the full list so the
   *  preview token (which was issued for the complete invite digest) validates correctly. */
  inviteDigest: z.string().max(128).optional(),
  invites: z
    .array(
      inviteeSchema.extend({
        firstName: bulkInviteNameSchema(80),
        lastName: bulkInviteNameSchema(120),
        sourceType: sourceTypeSchema.optional(),
      }),
    )
    .min(1)
    .max(2000),
});

export const adminBulkAttendeeInvitesPreviewSchema = z.object({
  invites: z
    .array(
      inviteeSchema.extend({
        firstName: bulkInviteNameSchema(80),
        lastName: bulkInviteNameSchema(120),
        sourceType: sourceTypeSchema.optional(),
      }),
    )
    .min(1)
    .max(50000),
});

export const adminBulkSpeakerInvitesSchema = z.object({
  invites: z
    .array(
      inviteeSchema.extend({
        firstName: bulkInviteNameSchema(80),
        lastName: bulkInviteNameSchema(120),
        sourceType: sourceTypeSchema.optional(),
      }),
    )
    .min(1)
    .max(2000),
});

export const adminRegistrationAdmitSchema = z.object({
  mode: z.enum(["vip", "capacity_exempt"]).default("vip"),
  reason: trimmedString(3, 1000),
  dayDates: z.array(dayDateSchema).min(1).max(31).optional(),
});

export const adminManageDayAttendanceSchema = z.object({
  action: z.enum(["in_person", "virtual", "on_demand", "remove"]),
  dayDates: z.array(dayDateSchema).min(1).max(31),
});

// ── Admin: campaign emails ────────────────────────────────────────────────────

const campaignFilterSchema = z.object({
  audience: z.enum(["attendees", "speakers"]),
  attendeeStatus: z.enum(["all", "registered", "pending_email_confirmation", "cancelled"]).optional(),
  attendanceType: z.enum(["all", "in_person", "virtual", "on_demand"]).optional(),
  dayDate: z.string().trim().max(20).optional(),
  dayWaitlistStatus: z.enum(["all", "active", "waiting", "offered", "accepted", "none"]).optional(),
  speakerStatus: z.enum(["all", "confirmed", "invited", "pending"]).optional(),
});

const campaignBaseSchema = z.object({
  templateKey: z.string().trim().min(1).max(200).optional(),
  subjectOverride: z.string().trim().min(1).max(500).optional(),
  customText: z.string().trim().max(100_000).optional(),
  bodyContent: z.string().trim().max(100_000).optional(),
  messageType: emailMessageTypeSchema.optional(),
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
