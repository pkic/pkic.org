import { z } from "zod";
import { normalizedEmailSchema } from "./api-common";
import { authMemberSchema } from "./member-auth";
import { publicOperation } from "./route-contract";

export const memberJoinApplicantKindSchema = z.enum(["organization", "individual"]);
export type MemberJoinApplicantKind = z.infer<typeof memberJoinApplicantKindSchema>;

export const memberJoinStartSchema = z.object({
  email: normalizedEmailSchema,
  /** Explicit policy attestation, never inferred from choosing an easy category. */
  unaffiliatedAttestation: z.boolean().default(false),
});

export const memberJoinStartResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("verification_sent") }),
  z.object({ status: z.literal("unaffiliated_attestation_required") }),
]);

export const memberJoinVerifySchema = z.object({ token: z.string().min(32).max(1024) });
export const memberJoinVerifyResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("application_ready"),
    applicantEmail: normalizedEmailSchema,
    applicantKind: memberJoinApplicantKindSchema,
    joinToken: z.string().min(32).max(1024),
  }),
  z.object({
    status: z.literal("organization_access_ready"),
    expiresAt: z.string(),
    member: authMemberSchema,
  }),
  z.object({ status: z.literal("support_required") }),
]);

export const memberJoinStartRouteSchema = {
  ...publicOperation(),
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
    "422": { description: "Disposable or invalid email address." },
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
