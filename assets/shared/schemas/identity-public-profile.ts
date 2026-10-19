/**
 * One identity as staff read and change it: the profile every record made as
 * the identity shows, and whether it shows on its person's public profile.
 * Identities are not hidden in principle; withholding one is a staff decision
 * on the identity itself, audited, never a self-service choice.
 */
import { z } from "zod";
import { jsonErrorResponse, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { identityProfileUpdateSchema } from "./own-identity-profile";
import { requiresSession } from "./route-contract";

export const identityParamsSchema = z.object({ identityId: databaseIdSchema });

export const identityPublicProfileSchema = z.object({
  identityId: databaseIdSchema,
  userId: databaseIdSchema,
  /** The person the identity belongs to, as the portal names them. */
  personName: z.string(),
  organizationName: z.string().nullable(),
  endedAt: utcInstantSchema.nullable(),
  hiddenFromPublicProfile: z.boolean(),
});
export type IdentityPublicProfile = z.infer<typeof identityPublicProfileSchema>;

export const identityPublicProfileUpdateSchema = z.object({ hiddenFromPublicProfile: z.boolean() });

/**
 * The identity with its profile: the job title, biography and links the
 * owner edits, which every record made as the identity shows.
 */
export const identityRecordSchema = identityPublicProfileSchema.extend({
  organizationId: databaseIdSchema.nullable(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: linksSchema,
});
export type IdentityRecord = z.infer<typeof identityRecordSchema>;

const IDENTITY_PROFILE_KEYS = Object.keys(identityProfileUpdateSchema.shape) as Array<
  keyof z.infer<typeof identityProfileUpdateSchema>
>;

/** Whether a staff edit changes the identity's profile rather than its public-profile visibility. */
export function isIdentityProfileEdit(value: { [key: string]: unknown }): boolean {
  return IDENTITY_PROFILE_KEYS.some((key) => value[key] !== undefined);
}

/**
 * A staff edit of one identity: its profile, through the owner's own edit
 * contract, or its place on the public profile. One change per request, so
 * each is one audited write.
 */
export const identityUpdateSchema = identityProfileUpdateSchema
  .extend({ hiddenFromPublicProfile: z.boolean().optional() })
  .superRefine((value, context) => {
    const profile = isIdentityProfileEdit(value);
    const visibility = value.hiddenFromPublicProfile !== undefined;
    if (!profile && !visibility)
      context.addIssue({ code: "custom", message: "Change the identity's profile or its place on the public profile" });
    if (profile && visibility)
      context.addIssue({
        code: "custom",
        path: ["hiddenFromPublicProfile"],
        message: "Change the profile and the public-profile visibility separately",
      });
  });
export type IdentityUpdate = z.infer<typeof identityUpdateSchema>;

export const identityGetRouteSchema = {
  ...requiresSession(),
  tags: ["Identities"],
  summary: "Get one identity's profile and whether it shows on its person's public profile",
  description: "Requires membership:read.",
  request: { params: identityParamsSchema },
  responses: {
    "200": { description: "The identity.", content: { "application/json": { schema: identityRecordSchema } } },
    "403": jsonErrorResponse("membership:read is required."),
    "404": jsonErrorResponse("Identity not found."),
  },
};

export const identityUpdateRouteSchema = {
  ...requiresSession(),
  tags: ["Identities"],
  summary: "Edit an identity's profile, or hide it from or show it on its person's public profile",
  description:
    "Requires a user-backed staff session with membership:write. The profile takes the fields its owner edits; every record made as the identity shows the edit, so it is audited with the previous values, and only an active identity's profile can be edited. Every identity, ended ones as past, shows on the public profile unless staff hide it; that change is audited on the identity too.",
  request: {
    params: identityParamsSchema,
    body: { required: true, content: { "application/json": { schema: identityUpdateSchema } } },
  },
  responses: {
    "200": { description: "The identity.", content: { "application/json": { schema: identityRecordSchema } } },
    "400": jsonErrorResponse("The edit is invalid, or would leave an organization identity without a job title."),
    "403": jsonErrorResponse("membership:write is required."),
    "404": jsonErrorResponse("Identity not found."),
    "409": jsonErrorResponse("The identity changed, or is no longer active, before the change was saved."),
  },
};
