/**
 * What the signed-in person is asked about their organization.
 *
 * `linked`: a verified address linked them to an organization automatically.
 * They are told once: keeping it closes the notice (POST .../offer/confirmations);
 * "not my organization" (the dismissal below) ends that identity.
 *
 * `organization`: one of their verified work addresses belongs to an
 * organization they have no relationship with yet. Accepting it is the
 * existing join (POST /api/v1/users/current/identities); "not my
 * organization" dismisses that organization for them.
 *
 * `work_address`: they hold no organization identity and every verified
 * address they have is free or consumer mail, which never links to an
 * organization. They are asked to verify their organization's address, or
 * to say they are independent.
 */
import { z } from "zod";
import { organizationIdentityJobTitleSchema } from "./identity-job-title";
import { jsonErrorResponse, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { requiresSession } from "./route-contract";

export const affiliationOfferSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("linked"),
    /** The organization a verified address linked them to automatically. */
    organization: z.object({ id: databaseIdSchema, name: z.string() }),
    /** The identity the link created; "not my organization" ends it. */
    identityId: databaseIdSchema,
    domain: z.string(),
  }),
  z.object({
    kind: z.literal("organization"),
    organization: z.object({ id: databaseIdSchema, name: z.string() }),
    /** The verified address whose domain the organization owns; null id is the primary address. */
    emailId: databaseIdSchema.nullable(),
    domain: z.string(),
    /** What their profile said before organizations became identities, when they wrote something. */
    writtenOrganizationName: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("work_address"),
    /** The free or consumer domains their verified addresses are on. */
    freeDomains: z.array(z.string()),
    writtenOrganizationName: z.string().nullable(),
  }),
]);
export type AffiliationOffer = z.infer<typeof affiliationOfferSchema>;

export const affiliationOfferResponseSchema = z.object({ offer: affiliationOfferSchema.nullable() });

/** `organizationId` names the organization that is not theirs; null says they are independent. */
export const affiliationOfferDismissalSchema = z.object({ organizationId: databaseIdSchema.nullable() });

/** Keeps the organization an address linked them to automatically. */
/** Keeping an automatic link says what the person does there: an organization identity always has a job title. */
export const affiliationLinkKeptSchema = z.object({
  organizationId: databaseIdSchema,
  jobTitle: organizationIdentityJobTitleSchema,
});

export const affiliationOfferGetRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Get the current user's organization offer",
  description:
    "The organization one of the current user's verified work addresses belongs to, or a request for a work address when every verified address is free mail. Null when nothing needs asking.",
  responses: {
    "200": {
      description: "The current offer, if any.",
      content: { "application/json": { schema: affiliationOfferResponseSchema } },
    },
  },
};

export const affiliationOfferDismissalRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Dismiss the current user's organization offer",
  description:
    "Records that the organization is not theirs, or that they are independent. When a verified address linked them to that organization automatically, the identity the link created ends.",
  request: {
    body: { required: true, content: { "application/json": { schema: affiliationOfferDismissalSchema } } },
  },
  responses: {
    "201": { description: "Dismissal recorded.", content: { "application/json": { schema: successResponseSchema } } },
    "404": jsonErrorResponse("Organization not found."),
  },
};

export const affiliationLinkKeptRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Keep the organization a verified address linked automatically",
  description: "Closes the notice that told the current user about an automatic link; the identity stays.",
  request: {
    body: { required: true, content: { "application/json": { schema: affiliationLinkKeptSchema } } },
  },
  responses: {
    "201": { description: "Notice closed.", content: { "application/json": { schema: successResponseSchema } } },
  },
};
