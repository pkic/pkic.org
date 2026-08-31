/**
 * Member self-service. All endpoints operate on the
 * caller's own identity, resolved from the shared human session — never a
 * target-user path parameter.
 */
import { z } from "zod";
import { successResponseSchema } from "./api-common";
import { httpOrSameOriginUrlSchema } from "./urls";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { applicationStageSchema } from "./member-applications";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { requiresSession } from "./route-contract";
import { verifiedEmailIdentitySchema } from "./identity";

export const myActingIdentitySchema = z.object({
  identityId: databaseIdSchema,
  userId: databaseIdSchema,
  name: z.string().nullable(),
  email: z.string(),
  showOnOrgProfile: z.boolean(),
  isPrimaryContact: z.boolean(),
  isSecondaryContact: z.boolean(),
});

// One membership context (own org-less membership, or an organization
// actively represented) a member can act as. A person can hold more than
// one at once — see functions/_lib/auth/user-session.ts.
export const myActiveIdentitySchema = z.object({
  identityId: databaseIdSchema,
  memberId: databaseIdSchema,
  organizationId: databaseIdSchema.nullable(),
  organizationName: z.string().nullable(),
  membershipCategory: z.string(),
});

export const myProfileSchema = z.object({
  userId: databaseIdSchema,
  emailId: databaseIdSchema.nullable(),
  email: z.string(),
  emailAddresses: z.array(verifiedEmailIdentitySchema),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  preferredName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: linksSchema,
  membershipCategory: z.string(),
  organizationId: databaseIdSchema.nullable(),
  organizationName: z.string().nullable(),
  memberSince: z.string(),
  showOnOrgProfile: z.boolean(),
  headshotUrl: httpOrSameOriginUrlSchema.nullable(),
  // Member portal (self-service coworker enrollment): true when this member
  // is their organization's primary or secondary contact. Always false for
  // org-less (H5/H6/H7) members.
  isOrgContact: z.boolean(),
  // Full active identity roster for the caller's organization, or null when
  // the member has no organization.
  organizationIdentities: z.array(myActingIdentitySchema).nullable(),
  // Every membership context this member is currently eligible to act
  // through. Always at least one entry (the one reflected in the fields
  // above); more than one only when the caller represents multiple
  // organizations (or an organization plus their own individual
  // membership) concurrently.
  activeIdentities: z.array(myActiveIdentitySchema).min(1),
});

export const myProfileGetRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Get the current user's member profile",
  responses: {
    "200": { description: "My profile.", content: { "application/json": { schema: myProfileSchema } } },
  },
};

export const myActiveIdentitySwitchSchema = z.object({
  identityId: databaseIdSchema,
});

export const myActiveIdentitySwitchRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Replace the current user's active acting identity",
  description:
    "Only meaningful for a user with more than one active identity. Re-verifies identityId against the caller's live identities, derives the matching Member aggregate, and reissues the shared human session cookie scoped to that exact identity.",
  request: {
    body: { content: { "application/json": { schema: myActiveIdentitySwitchSchema } }, required: true },
  },
  responses: {
    "200": { description: "Switched.", content: { "application/json": { schema: myProfileSchema } } },
    "403": { description: "The caller does not actively hold this identity." },
  },
};

export const myProfileUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  preferredName: z.string().trim().max(120).optional(),
  emailId: databaseIdSchema.nullable().optional(),
  jobTitle: z.string().trim().max(160).optional(),
  biography: z.string().trim().max(5000).optional(),
  links: linksSchema.optional(),
  showOnOrgProfile: z.boolean().optional(),
});

export const myProfileUpdateRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Update the current user's member profile",
  description:
    "Updates global person naming plus the selected identity profile. Individual identities cannot set a job title or organization affiliation.",
  request: {
    body: { content: { "application/json": { schema: myProfileUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Updated profile.", content: { "application/json": { schema: myProfileSchema } } },
  },
};

export const myApplicationSummarySchema = z.object({
  id: z.string(),
  stage: applicationStageSchema,
  membershipCategory: z.string(),
  createdAt: z.string(),
});

export const MY_APPLICATION_SORT_COLUMNS = ["createdAt", "stage"] as const;
export const myApplicationsListQuerySchema = listQuerySchema(MY_APPLICATION_SORT_COLUMNS, { limit: 25 });
export type MyApplicationsListQuery = z.infer<typeof myApplicationsListQuerySchema>;
export const myApplicationsListResponseSchema = paginatedResponseSchema("applications", myApplicationSummarySchema);

export const myApplicationsListRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Membership"],
  summary: "List the current user's application history",
  request: { query: myApplicationsListQuerySchema },
  responses: {
    "200": {
      description: "My applications.",
      content: {
        "application/json": {
          schema: myApplicationsListResponseSchema,
        },
      },
    },
  },
};

export const myApplicationTimelineEntrySchema = z.object({
  fromStage: applicationStageSchema.nullable(),
  toStage: applicationStageSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
});

export const myApplicationCommunicationEntrySchema = z.object({
  subject: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});

export const myApplicationDetailSchema = z.object({
  id: z.string(),
  applicantName: z.string(),
  applicantEmail: z.string(),
  organizationName: z.string().nullable(),
  membershipCategory: z.string(),
  stage: applicationStageSchema,
  stageEnteredAt: z.string(),
  createdAt: z.string(),
  timeline: z.array(myApplicationTimelineEntrySchema),
  communications: z.array(myApplicationCommunicationEntrySchema),
});

export const myApplicationDetailRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Membership"],
  summary: "Get the current user's application detail, status history, and timeline",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": { description: "My application.", content: { "application/json": { schema: myApplicationDetailSchema } } },
    "404": { description: "Not found, or does not belong to the caller." },
  },
};

export const myHeadshotUploadResponseSchema = successResponseSchema;

export const myHeadshotUploadRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Replace the current user's headshot",
  description: "multipart/form-data with a single 'file' field. JPEG, PNG, or WebP, up to 5MB.",
  responses: {
    "200": {
      description: "Uploaded.",
      content: { "application/json": { schema: myHeadshotUploadResponseSchema } },
    },
    "413": { description: "File too large." },
    "415": { description: "Unsupported file type." },
  },
};
// ── Notification preferences (Account Settings) ─────────

export const myNotificationPreferencesSchema = z.object({
  workingGroupUpdates: z.boolean(),
  voteReminders: z.boolean(),
  generalAnnouncements: z.boolean(),
  // Weekly digest of working-group join/leave activity, sent only to
  // members currently assigned as a WG chair or vice-chair (2026-07-31
  // manual-testing feedback — see wg-chair-digest.ts). Shown to every
  // member in Account Settings regardless of chair status, matching this
  // schema's existing precedent: voteReminders is shown regardless of the
  // current D1-configured voting eligibility of the member's category.
  wgChairMembershipDigest: z.boolean(),
});

export const myNotificationPreferencesGetRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Get the current user's email notification preferences",
  responses: {
    "200": {
      description: "My notification preferences (all default to true/opted-in).",
      content: { "application/json": { schema: myNotificationPreferencesSchema } },
    },
  },
};

export const myNotificationPreferencesUpdateSchema = myNotificationPreferencesSchema.partial();

export const myNotificationPreferencesUpdateRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Update the current user's email notification preferences",
  request: {
    body: { content: { "application/json": { schema: myNotificationPreferencesUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Updated preferences.",
      content: { "application/json": { schema: myNotificationPreferencesSchema } },
    },
  },
};
