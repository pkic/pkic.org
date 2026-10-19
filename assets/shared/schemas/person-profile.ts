/**
 * A person's professional profile: one projection for the static page at
 * /people/<slug>/ and for its owner's view in the portal. Both read the same
 * contract; the owner's copy also carries what is not published, marked so.
 */
import { z } from "zod";
import { userIdParamsSchema, utcInstantSchema } from "./api-common";
import { linksSchema } from "./links";
import { requiresSession } from "./route-contract";
import { sameOriginPathSchema } from "./urls";
import { publicPageSlugSchema } from "./public-page-slug";
import { clockCitySchema } from "../event-clock";

/**
 * Whether an identity appears on the profile. Every identity is public unless
 * staff withheld it; a hidden one only ever reaches its owner.
 */
export const PERSON_IDENTITY_VISIBILITIES = ["public", "hidden"] as const;
export const personIdentityVisibilitySchema = z.enum(PERSON_IDENTITY_VISIBILITIES);
export type PersonIdentityVisibility = z.infer<typeof personIdentityVisibilitySchema>;

const organizationSchema = z.object({
  name: z.string().min(1),
  logoSrc: z.string().min(1).optional(),
  href: sameOriginPathSchema.optional(),
});

/** One capacity a person holds or held, as its sources record it. */
export const publishedPersonIdentitySchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  organizationId: z.string().min(1).nullable(),
  organizationName: z.string().nullable(),
  /** Live organization branding, never frozen. */
  organizationLogoUrl: z.string().min(1).nullable(),
  startedAt: utcInstantSchema.nullable(),
  endedAt: utcInstantSchema.nullable(),
  biography: z.string(),
  links: linksSchema,
  visibility: personIdentityVisibilitySchema,
});
export type PublishedPersonIdentity = z.infer<typeof publishedPersonIdentitySchema>;

/** A seat or leadership title in a group that publishes it. */
export const personGroupRoleSchema = z.object({
  groupSlug: z.string().min(1),
  groupName: z.string().min(1),
  title: z.string().min(1),
  leadership: z.boolean(),
  startsAt: utcInstantSchema.nullable(),
  endsAt: utcInstantSchema.nullable(),
});
export type PersonGroupRole = z.infer<typeof personGroupRoleSchema>;

/** A candidacy in a public election; the vote has its own page. */
export const personCandidacySchema = z.object({
  voteSlug: z.string().min(1),
  voteTitle: z.string().min(1),
  ownerGroupName: z.string(),
  closesAt: utcInstantSchema,
});
export type PersonCandidacy = z.infer<typeof personCandidacySchema>;

/** Contributions read once from canonical data, for the publication snapshot and the owner's view alike. */
export const publishedPersonSchema = z.object({
  /** The account's own name; an approved appearance names a speaker instead. */
  name: z.string().min(1),
  /** The person's current public profile address, once one is issued. */
  slug: publicPageSlugSchema.nullable(),
  identities: z.array(publishedPersonIdentitySchema),
  groups: z.array(personGroupRoleSchema),
  candidacies: z.array(personCandidacySchema),
});
export type PublishedPerson = z.infer<typeof publishedPersonSchema>;

const affiliationSchema = z.object({ title: z.string().optional(), organization: organizationSchema.optional() });

/** One appearance on an approved agenda, in the representation approved for it. */
export const personProfileSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  startsAt: utcInstantSchema,
  timeZone: z.string().min(1),
  clockCity: clockCitySchema.optional(),
  room: z.string(),
  url: sameOriginPathSchema.optional(),
  moderator: z.boolean(),
  roleLabel: z.string().optional(),
  affiliations: z.array(affiliationSchema).optional(),
});

export const personProfileEventSchema = z.object({
  eventName: z.string().min(1),
  agendaPage: sameOriginPathSchema,
  timeZone: z.string().min(1),
  clockCity: clockCitySchema.optional(),
  sessions: z.array(personProfileSessionSchema),
});
export type PersonProfileEvent = z.infer<typeof personProfileEventSchema>;

export const personProfileIdentitySchema = publishedPersonIdentitySchema
  .omit({ organizationId: true, organizationName: true, organizationLogoUrl: true })
  .extend({ organization: organizationSchema.nullable() });
export type PersonProfileIdentity = z.infer<typeof personProfileIdentitySchema>;

export const personProfileSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  /** The public page's address, present only when the static site renders it. */
  route: sameOriginPathSchema.nullable(),
  imageSrc: z.string().min(1).nullable(),
  /** One line saying who the person is now: their leading public capacity. */
  headline: z.string().nullable(),
  /** The biography the person most recently approved for publication. */
  biographyMarkdown: z.string(),
  links: linksSchema,
  identities: z.array(personProfileIdentitySchema),
  events: z.array(personProfileEventSchema),
  groups: z.array(personGroupRoleSchema),
  candidacies: z.array(personCandidacySchema),
});
export type PersonProfile = z.infer<typeof personProfileSchema>;

export const PERSON_PROFILE_AUDIENCES = ["public", "owner"] as const;
export const personProfileAudienceSchema = z.enum(PERSON_PROFILE_AUDIENCES);
export type PersonProfileAudience = z.infer<typeof personProfileAudienceSchema>;

export const personProfileResponseSchema = z.object({
  audience: personProfileAudienceSchema,
  profile: personProfileSchema,
});
export type PersonProfileResponse = z.infer<typeof personProfileResponseSchema>;

export const personProfileGetRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Get a person's professional profile",
  description:
    "The profile projection the public page at /people/<slug>/ renders. A person reading their own profile also receives their hidden identities, marked as hidden; any other signed-in member or users:read holder receives only what is public.",
  request: { params: userIdParamsSchema },
  responses: {
    "200": {
      description: "The profile and the audience it was projected for.",
      content: { "application/json": { schema: personProfileResponseSchema } },
    },
    "404": { description: "User not found." },
  },
};
