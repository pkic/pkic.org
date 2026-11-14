import { z } from "zod";
import { normalizedEmailSchema, organizationNameSchema } from "./api-common";
import { sameOriginPathSchema } from "./urls";
import { authErrors, ok, requiresSession } from "./route-contract";
import { databaseIdSchema } from "./identifiers";
import { emailDomainNameSchema } from "./email-domains";
import { identityAffiliationPreviewResponseSchema } from "./identity-affiliation";

export const memberJoinApplicantKindSchema = z.enum(["organization", "individual"]);
export type MemberJoinApplicantKind = z.infer<typeof memberJoinApplicantKindSchema>;

/**
 * A signed-in person's choice of membership path. The account's own proved
 * address stands for the applicant; the individual capacity stays an explicit
 * attestation and is never inferred from that address.
 */
export const memberJoinVerifySchema = z.object({
  unaffiliatedAttestation: z.boolean().default(false),
  organizationId: databaseIdSchema.optional(),
  organizationName: organizationNameSchema.optional(),
  domain: emailDomainNameSchema.optional(),
  continueAsIndividual: z.boolean().optional(),
});
export const memberJoinVerifyResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("application_ready"),
    applicantEmail: normalizedEmailSchema,
    applicantKind: memberJoinApplicantKindSchema,
    organizationName: organizationNameSchema.optional(),
    joinToken: z.string().min(32).max(1024),
  }),
  /** The person now represents an active member organization; their session acts as that representation. */
  z.object({ status: z.literal("organization_access_ready") }),
  z.object({ status: z.literal("support_required") }),
  z.object({
    status: z.literal("organization_selection_required"),
    domain: emailDomainNameSchema,
    affiliation: identityAffiliationPreviewResponseSchema,
    canApplyAsIndividual: z.boolean().default(false),
    organizations: z
      .array(
        z.object({
          id: databaseIdSchema,
          name: z.string(),
        }),
      )
      .max(256),
  }),
  z.object({ status: z.literal("already_member") }),
  /** The account already has an open application; the path is a status-only link to it. */
  z.object({ status: z.literal("application_in_progress"), statusPath: sameOriginPathSchema }),
  /** Someone else's open application already holds the organization domain the address links through. */
  z.object({ status: z.literal("organization_application_in_progress") }),
]);

export const memberJoinVerifyRouteSchema = {
  ...requiresSession(),
  tags: ["Members"],
  summary: "Resolve a signed-in person's membership path",
  description:
    "Decides from the signed-in account's proved address whether the person represents an existing member organization, chooses an organization, or continues with a short-lived application capability.",
  request: { body: { content: { "application/json": { schema: memberJoinVerifySchema } }, required: true } },
  responses: {
    ...ok("Membership path decision.", memberJoinVerifyResponseSchema),
    ...authErrors({
      badRequest: "A personal mailbox without the individual capacity, or a disposable mailbox.",
      conflict: "The organization affiliation changed; choose again.",
      unprocessable: "The choice does not fit this membership path.",
      tooManyRequests: "Too many requests.",
    }),
  },
};

export const memberJoinAffiliationPreviewSchema = memberJoinVerifySchema.pick({ domain: true });
export const memberJoinAffiliationPreviewRouteSchema = {
  ...requiresSession(),
  tags: ["Members"],
  summary: "Preview organizations for a signed-in person's address",
  request: {
    body: { content: { "application/json": { schema: memberJoinAffiliationPreviewSchema } }, required: true },
  },
  responses: {
    ...ok("Read-only affiliation preview.", identityAffiliationPreviewResponseSchema),
    ...authErrors({ unprocessable: "The account's address is not a work address." }),
  },
};
