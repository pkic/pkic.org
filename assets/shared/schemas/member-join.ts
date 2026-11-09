import { protectsPublicAction } from "./abuse-protection";
import { z } from "zod";
import { normalizedEmailSchema, organizationNameSchema } from "./api-common";
import { sameOriginPathSchema } from "./urls";
import { authMemberSchema } from "./member-auth";
import { publicOperation } from "./route-contract";
import { screensWorkEmailDomain, workEmailStepSchema } from "./work-email";
import { databaseIdSchema } from "./identifiers";
import { emailDomainNameSchema } from "./email-domains";
import { identityAffiliationPreviewResponseSchema } from "./identity-affiliation";

export const memberJoinApplicantKindSchema = z.enum(["organization", "individual"]);
export type MemberJoinApplicantKind = z.infer<typeof memberJoinApplicantKindSchema>;

/** Joining starts from the shared email-first step; the individual capacity is an explicit attestation. */
export const memberJoinStartSchema = workEmailStepSchema;

export const memberJoinStartResponseSchema = z.object({ status: z.literal("verification_sent") });

export const memberJoinVerifySchema = z.object({
  token: z.string().min(32).max(1024),
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
  z.object({
    status: z.literal("organization_access_ready"),
    expiresAt: z.string(),
    member: authMemberSchema,
  }),
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
  /** The proved address already has an open application; the path is a status-only link to it. */
  z.object({ status: z.literal("application_in_progress"), statusPath: sameOriginPathSchema }),
  /** Someone else's open application already holds the organization domain the address links through. */
  z.object({ status: z.literal("organization_application_in_progress") }),
]);

export const memberJoinStartRouteSchema = {
  ...protectsPublicAction("membership_join", "membership:write"),
  ...publicOperation(),
  ...screensWorkEmailDomain(),
  tags: ["Members"],
  summary: "Start a verified membership join flow",
  description:
    "Queues a short-lived mailbox verification link without disclosing whether the email domain belongs to a member organization.",
  request: { body: { content: { "application/json": { schema: memberJoinStartSchema } }, required: true } },
  responses: {
    "200": {
      description: "A generic next step that does not disclose organization membership.",
      content: { "application/json": { schema: memberJoinStartResponseSchema } },
    },
    "400": { description: "Invalid, disposable, or free email address without the individual capacity." },
    "429": { description: "Too many verification requests." },
  },
};

export const memberJoinVerifyRouteSchema = {
  ...publicOperation(),
  tags: ["Members"],
  summary: "Verify a membership join email",
  description:
    "Verifies a short-lived mailbox proof, reuses an existing claimed organization membership when possible, or issues a short-lived application capability.",
  request: { body: { content: { "application/json": { schema: memberJoinVerifySchema } }, required: true } },
  responses: {
    "200": {
      description: "Verified join decision.",
      content: { "application/json": { schema: memberJoinVerifyResponseSchema } },
    },
    "404": { description: "Invalid verification link." },
    "409": { description: "Verification link already used." },
    "410": { description: "Verification link expired." },
  },
};

export const memberJoinAffiliationPreviewSchema = memberJoinVerifySchema.pick({ token: true, domain: true });
export const memberJoinAffiliationPreviewRouteSchema = {
  ...publicOperation(),
  tags: ["Members"],
  summary: "Preview organizations for a verified join email",
  request: {
    body: { content: { "application/json": { schema: memberJoinAffiliationPreviewSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Read-only affiliation preview.",
      content: { "application/json": { schema: identityAffiliationPreviewResponseSchema } },
    },
  },
};
