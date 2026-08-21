/**
 * Meeting calendar management. Backs the WG-nested
 * admin surface (`/admin/working-groups/:id/meetings[/...]`), the
 * consortium admin surface (`/admin/consortium/meetings[/...]`), the public
 * `GET /working-groups/:wgId/meetings`, and member self-service
 * (`/me/calendar[/...]`).
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { workingGroupIdSchema, workingGroupReferenceSchema } from "./working-groups";

export const meetingSeriesIdParamsSchema = z.object({ id: workingGroupReferenceSchema });
export const meetingSeriesWithMeetingIdParamsSchema = z.object({
  id: workingGroupReferenceSchema,
  meetingId: databaseIdSchema,
});
export const meetingIcsFileParamsSchema = z.object({
  id: workingGroupReferenceSchema,
  meetingId: databaseIdSchema,
  fileId: databaseIdSchema,
});

export const consortiumMeetingIdParamsSchema = z.object({ meetingId: databaseIdSchema });
export const consortiumIcsFileParamsSchema = z.object({ meetingId: databaseIdSchema, fileId: databaseIdSchema });

export const meetingSeriesCreateSchema = z.object({ name: z.string().trim().min(1).max(200) });
export const meetingSeriesUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  active: z.boolean().optional(),
});
export const meetingIcsFileUpdateSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().optional(),
});

export const adminIcsFileSummarySchema = z.object({
  id: databaseIdSchema,
  label: z.string(),
  year: z.number(),
  r2Key: z.string(),
  active: z.boolean(),
  uploadedByUserId: databaseIdSchema.nullable(),
  createdAt: z.string(),
});

export const adminMeetingSeriesSummarySchema = z.object({
  id: databaseIdSchema,
  name: z.string(),
  scopeType: z.enum(["consortium", "working_group"]),
  workingGroupId: workingGroupIdSchema.nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  icsFiles: z.array(adminIcsFileSummarySchema),
});

export const meetingResendResultSchema = z.object({
  success: z.boolean(),
  seriesName: z.string(),
  queuedRecipients: z.number(),
});

export type AdminIcsFile = z.infer<typeof adminIcsFileSummarySchema>;
export type AdminMeetingSeries = z.infer<typeof adminMeetingSeriesSummarySchema>;
export type MeetingResendResult = z.infer<typeof meetingResendResultSchema>;

// ── WG-nested admin routes ─────────────────────────────────────────────

export const wgMeetingsListRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "List a working group's meeting series (admin)",
  request: { params: meetingSeriesIdParamsSchema },
  responses: {
    "200": {
      description: "Meeting series for this working group.",
      content: {
        "application/json": { schema: z.object({ meetingSeries: z.array(adminMeetingSeriesSummarySchema) }) },
      },
    },
    "404": { description: "Working group not found." },
  },
};

export const wgMeetingsCreateRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Create a meeting series for a working group",
  request: {
    params: meetingSeriesIdParamsSchema,
    body: { content: { "application/json": { schema: meetingSeriesCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Meeting series created.",
      content: { "application/json": { schema: z.object({ meetingSeries: adminMeetingSeriesSummarySchema }) } },
    },
    "404": { description: "Working group not found." },
  },
};

export const wgMeetingUpdateRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Update a working group's meeting series",
  request: {
    params: meetingSeriesWithMeetingIdParamsSchema,
    body: { content: { "application/json": { schema: meetingSeriesUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Meeting series updated.",
      content: { "application/json": { schema: z.object({ meetingSeries: adminMeetingSeriesSummarySchema }) } },
    },
    "404": { description: "Meeting series not found." },
  },
};

export const wgMeetingIcsUploadRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Upload a new ICS file variant to a working group meeting series",
  description: "multipart/form-data with 'file', 'label', and 'year' fields.",
  request: { params: meetingSeriesWithMeetingIdParamsSchema },
  responses: {
    "201": {
      description: "ICS file uploaded.",
      content: { "application/json": { schema: z.object({ icsFile: adminIcsFileSummarySchema }) } },
    },
    "404": { description: "Meeting series not found." },
    "413": { description: "File too large." },
  },
};

export const wgMeetingIcsUpdateRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Update or deactivate a working group meeting series' ICS file",
  description: "Deactivation is non-destructive (R2 object retained) and clears any member preference pointing at it.",
  request: {
    params: meetingIcsFileParamsSchema,
    body: { content: { "application/json": { schema: meetingIcsFileUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "ICS file updated.",
      content: { "application/json": { schema: z.object({ icsFile: adminIcsFileSummarySchema }) } },
    },
    "404": { description: "ICS file not found." },
  },
};

export const wgMeetingDeleteRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Delete a working group's meeting series",
  description: "Deletes the series, all of its ICS file variants (R2 objects included), and any member preferences.",
  request: { params: meetingSeriesWithMeetingIdParamsSchema },
  responses: {
    "200": { description: "Deleted." },
    "404": { description: "Meeting series not found." },
  },
};

export const wgMeetingIcsDeleteRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Delete a working group meeting series' ICS file",
  description: "Unlike deactivation, this removes the file and its R2 object outright.",
  request: { params: meetingIcsFileParamsSchema },
  responses: {
    "200": { description: "Deleted." },
    "404": { description: "ICS file not found." },
  },
};

export const wgMeetingResendRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Trigger the annual bulk resend for a working group meeting series",
  request: { params: meetingSeriesWithMeetingIdParamsSchema },
  responses: {
    "200": {
      description: "Resend queued.",
      content: { "application/json": { schema: meetingResendResultSchema } },
    },
    "404": { description: "Meeting series not found." },
  },
};

// ── Consortium admin routes ─────────────────────────────────────────────

export const consortiumMeetingsListRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "List consortium meeting series (admin)",
  responses: {
    "200": {
      description: "Consortium meeting series.",
      content: {
        "application/json": { schema: z.object({ meetingSeries: z.array(adminMeetingSeriesSummarySchema) }) },
      },
    },
  },
};

export const consortiumMeetingsCreateRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Create a consortium meeting series",
  request: { body: { content: { "application/json": { schema: meetingSeriesCreateSchema } }, required: true } },
  responses: {
    "201": {
      description: "Meeting series created.",
      content: { "application/json": { schema: z.object({ meetingSeries: adminMeetingSeriesSummarySchema }) } },
    },
  },
};

export const consortiumMeetingUpdateRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Update a consortium meeting series",
  request: {
    params: consortiumMeetingIdParamsSchema,
    body: { content: { "application/json": { schema: meetingSeriesUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Meeting series updated.",
      content: { "application/json": { schema: z.object({ meetingSeries: adminMeetingSeriesSummarySchema }) } },
    },
    "404": { description: "Meeting series not found." },
  },
};

export const consortiumMeetingIcsUploadRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Upload a new ICS file variant to a consortium meeting series",
  description: "multipart/form-data with 'file', 'label', and 'year' fields.",
  request: { params: consortiumMeetingIdParamsSchema },
  responses: {
    "201": {
      description: "ICS file uploaded.",
      content: { "application/json": { schema: z.object({ icsFile: adminIcsFileSummarySchema }) } },
    },
    "404": { description: "Meeting series not found." },
    "413": { description: "File too large." },
  },
};

export const consortiumMeetingIcsUpdateRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Update or deactivate a consortium meeting series' ICS file",
  request: {
    params: consortiumIcsFileParamsSchema,
    body: { content: { "application/json": { schema: meetingIcsFileUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "ICS file updated.",
      content: { "application/json": { schema: z.object({ icsFile: adminIcsFileSummarySchema }) } },
    },
    "404": { description: "ICS file not found." },
  },
};

export const consortiumMeetingDeleteRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Delete a consortium meeting series",
  description: "Deletes the series, all of its ICS file variants (R2 objects included), and any member preferences.",
  request: { params: consortiumMeetingIdParamsSchema },
  responses: {
    "200": { description: "Deleted." },
    "404": { description: "Meeting series not found." },
  },
};

export const consortiumMeetingIcsDeleteRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Delete a consortium meeting series' ICS file",
  description: "Unlike deactivation, this removes the file and its R2 object outright.",
  request: { params: consortiumIcsFileParamsSchema },
  responses: {
    "200": { description: "Deleted." },
    "404": { description: "ICS file not found." },
  },
};

export const consortiumMeetingResendRouteSchema = {
  tags: ["Meeting Calendar"],
  summary: "Trigger the annual bulk resend for a consortium meeting series",
  request: { params: consortiumMeetingIdParamsSchema },
  responses: {
    "200": {
      description: "Resend queued.",
      content: { "application/json": { schema: meetingResendResultSchema } },
    },
    "404": { description: "Meeting series not found." },
  },
};

// ── Public ───────────────────────────────────────────────────────────────

export const publicMeetingSeriesSchema = z.object({ id: databaseIdSchema, name: z.string() });

export const publicWgMeetingsRouteSchema = {
  tags: ["Working Groups"],
  summary: "List a working group's active meeting series (public)",
  request: { params: z.object({ wgId: workingGroupReferenceSchema }) },
  responses: {
    "200": {
      description: "Active meeting series for this working group.",
      content: { "application/json": { schema: z.object({ meetingSeries: z.array(publicMeetingSeriesSchema) }) } },
    },
    "404": { description: "Working group not found." },
  },
};

// ── Member self-service ─────────────────────────────────────────────────

export const myMeetingSeriesIcsFileSchema = z.object({ id: databaseIdSchema, label: z.string(), year: z.number() });

export const myMeetingSeriesSchema = z.object({
  id: databaseIdSchema,
  name: z.string(),
  scopeType: z.enum(["consortium", "working_group"]),
  icsFiles: z.array(myMeetingSeriesIcsFileSchema),
  preferenceIcsFileId: databaseIdSchema.nullable(),
});

export const myCalendarListRouteSchema = {
  tags: ["Me"],
  summary: "List meeting series I'm subscribed to, with my preferences",
  responses: {
    "200": {
      description: "My meeting series.",
      content: { "application/json": { schema: z.object({ meetingSeries: z.array(myMeetingSeriesSchema) }) } },
    },
  },
};

export const myCalendarPreferenceSetSchema = z.object({ icsFileId: databaseIdSchema.nullable() });

export const myCalendarPreferenceRouteSchema = {
  tags: ["Me"],
  summary: "Set or clear my time-slot preference for a meeting series",
  request: {
    params: z.object({ seriesId: databaseIdSchema }),
    body: { content: { "application/json": { schema: myCalendarPreferenceSetSchema } }, required: true },
  },
  responses: {
    "200": { description: "Preference saved." },
    "403": { description: "Not a member of this series' working group." },
    "404": { description: "Meeting series or ICS file not found." },
  },
};

export const myCalendarDownloadRouteSchema = {
  tags: ["Me"],
  summary: "Download a specific ICS file",
  request: { params: z.object({ seriesId: databaseIdSchema, icsFileId: databaseIdSchema }) },
  responses: {
    "200": { description: "The ICS file." },
    "403": { description: "Not a member of this series' working group." },
    "404": { description: "Meeting series or ICS file not found." },
  },
};
