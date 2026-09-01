import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import {
  organizationProfileExtendedFieldsSchema,
  organizationProfileLongContentSchema,
  organizationProfileSummaryFieldsSchema,
} from "./organization-profile";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";

/** Schemas for the public member directory endpoints. */

export const publicMemberSummarySchema = z
  .object({
    id: z.string(),
    slug: z.string().nullable(),
    name: z.string(),
    memberType: z.string(),
    tier: z.string().nullable(),
    memberSince: z.string(),
  })
  .extend(organizationProfileSummaryFieldsSchema.shape);

export type PublicMemberSummary = z.infer<typeof publicMemberSummarySchema>;

/** group: "organization" = org-tied categories (A-G, H1-H4, H8); "independent" = org-less H5/H6/H7 */
export const MEMBERS_LIST_SORT_COLUMNS = ["name", "memberSince"] as const;
export const membersListQuerySchema = listQuerySchema(MEMBERS_LIST_SORT_COLUMNS).extend({
  group: z.enum(["all", "organization", "independent"]).default("all"),
});
export type MembersListQuery = z.infer<typeof membersListQuerySchema>;

export const membersListResponseSchema = paginatedResponseSchema("members", publicMemberSummarySchema);
export type MembersListResponse = z.infer<typeof membersListResponseSchema>;

export const membersListRouteSchema = {
  tags: ["Members"],
  summary: "Public member directory",
  description: "Paginated, publicly readable member directory. D1 is the source of truth.",
  request: { query: membersListQuerySchema },
  responses: {
    "200": {
      description: "Paginated member list.",
      content: { "application/json": { schema: membersListResponseSchema } },
    },
  },
};

export const memberWallQuerySchema = z.object({
  memberLimit: z.coerce.number().int().min(0).max(200).optional(),
});

export const memberWallEntrySchema = z.object({
  key: z.string(),
  href: httpOrSameOriginUrlSchema,
  logoUrl: httpOrSameOriginUrlSchema,
  name: z.string(),
  slogan: z.string().nullable(),
  sponsorLevel: z.number().int().min(0),
  sponsorLevelName: z.string().nullable(),
});

export const memberWallResponseSchema = z.object({ entries: z.array(memberWallEntrySchema) });
export type MemberWallEntry = z.infer<typeof memberWallEntrySchema>;

export const memberWallRouteSchema = {
  tags: ["Members"],
  summary: "Public member and sponsor logo wall",
  description: "Returns the unified, display-ready member and sponsor wall from one bounded D1 read model.",
  request: { query: memberWallQuerySchema },
  responses: {
    "200": {
      description: "Display-ready wall entries.",
      content: { "application/json": { schema: memberWallResponseSchema } },
    },
  },
};

export const publicMemberIdentitySchema = z.object({
  name: z.string(),
  jobTitle: z.string().nullable(),
  bio: z.string().nullable(),
  linkedin: httpUrlSchema.nullable(),
  photoUrl: httpOrSameOriginUrlSchema.nullable(),
});

export const publicMemberDetailSchema = publicMemberSummarySchema.extend({
  ...organizationProfileExtendedFieldsSchema.omit({ contentMarkdown: true }).shape,
  content: organizationProfileLongContentSchema,
  // Populated for organization members from public active identities.
  // Empty for individual members; their identity profile is shown in the summary/detail fields.
  identities: z.array(publicMemberIdentitySchema),
  jobTitle: z.string().nullable(),
  linkedin: httpUrlSchema.nullable(),
});
export type PublicMemberDetail = z.infer<typeof publicMemberDetailSchema>;

export const memberLogoRouteSchema = {
  tags: ["Members"],
  summary: "Public organization logo",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": { description: "Logo image bytes." },
    "404": { description: "No logo on file." },
    "503": { description: "Asset storage is not configured." },
  },
};

export const memberDetailRouteSchema = {
  tags: ["Members"],
  summary: "Public member profile",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": {
      description: "Public member profile.",
      content: { "application/json": { schema: publicMemberDetailSchema } },
    },
    "404": { description: "Member not found." },
  },
};
