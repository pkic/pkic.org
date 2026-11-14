import { z } from "zod";
import { memberJoinApplicantKindSchema } from "../../../../../assets/shared/schemas/member-join";
import { normalizedEmailSchema, organizationNameSchema } from "../../../../../assets/shared/schemas/api-common";
import { emailDomainNameSchema } from "../../../../../assets/shared/schemas/email-domains";
import { databaseIdSchema } from "../../../../../assets/shared/schemas/identifiers";
import { signStatelessCapabilityToken, verifyStatelessCapabilityToken } from "../../../auth/capability-links";
import { AppError } from "../../../errors";
import { randomToken } from "../../../utils/crypto";
import { decodeCapabilityPayload, encodeCapabilityPayload } from "../../../auth/capability-payload";

const memberJoinCapabilityPayloadSchema = z.object({
  email: normalizedEmailSchema,
  applicantKind: memberJoinApplicantKindSchema,
  capabilityId: z.string().min(16).max(64),
});
export type MemberJoinCapabilityPayload = z.infer<typeof memberJoinCapabilityPayloadSchema>;

const memberJoinApplicationCapabilityPayloadSchema = memberJoinCapabilityPayloadSchema.extend({
  applicantUserId: databaseIdSchema.nullable(),
  organization: z
    .object({
      id: databaseIdSchema.optional(),
      name: organizationNameSchema,
      domain: emailDomainNameSchema,
      claimsFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
});
export type MemberJoinApplicationCapabilityPayload = z.infer<typeof memberJoinApplicationCapabilityPayloadSchema>;

/** One membership path a signed-in person resolved; its id binds the continuation to a single application. */
export function newMemberJoinCapabilityPayload(
  email: string,
  applicantKind: MemberJoinCapabilityPayload["applicantKind"],
): MemberJoinCapabilityPayload {
  return { email, applicantKind, capabilityId: randomToken(18) };
}

export function issueMemberJoinApplicationToken(
  signingSecret: string,
  payload: MemberJoinApplicationCapabilityPayload,
  ttlSeconds: number,
): Promise<string> {
  return signStatelessCapabilityToken({
    signingSecret,
    purpose: "member_join_apply",
    resourceId: encodeCapabilityPayload(payload),
    ttlSeconds,
  });
}

export async function verifyMemberJoinApplicationToken(
  signingSecret: string,
  token: string,
): Promise<MemberJoinApplicationCapabilityPayload> {
  const verified = await verifyStatelessCapabilityToken({
    signingSecret,
    purpose: "member_join_apply",
    token,
  });
  if (!verified.ok) {
    throw new AppError(
      verified.reason === "expired" ? 410 : 401,
      verified.reason === "expired" ? "MEMBER_JOIN_CAPABILITY_EXPIRED" : "MEMBER_JOIN_CAPABILITY_INVALID",
      verified.reason === "expired"
        ? "Membership application capability expired"
        : "Invalid membership application capability",
    );
  }
  const payload = decodeCapabilityPayload(verified.resourceId, memberJoinApplicationCapabilityPayloadSchema);
  if (!payload) throw new AppError(401, "MEMBER_JOIN_CAPABILITY_INVALID", "Invalid membership application capability");
  return payload;
}
