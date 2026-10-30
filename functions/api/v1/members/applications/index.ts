/**
 * POST /api/v1/members/applications
 *
 * Creates a member_applications record directly in D1 and queues its email
 * through the durable outbox. This is the only membership-application write
 * path; there is no generic form fallback. A visitor applies through the
 * verified-email link; a signed-in person applies as one of their identities.
 */
import { OpenAPIRoute } from "chanfana";
import { getConfig } from "../../../../_lib/config";
import { AppError } from "../../../../_lib/errors";
import { JSON_REQUEST_MAX_BYTES, readBoundedJsonBody } from "../../../../_lib/http-body";
import { json } from "../../../../_lib/http";
import { enforceEmailTriggerRateLimits } from "../../../../_lib/rate-limit";
import { getClientIp, requireInternalSecret } from "../../../../_lib/request";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { resolveUserSessionFromRequest } from "../../../../_lib/auth/user-session";
import { createMemberApplication } from "../../../../_lib/services/membership/applications/create";
import { createMemberApplicationAsIdentity } from "../../../../_lib/services/membership/applications/create-as-identity";
import { verifyMemberJoinApplicationToken } from "../../../../_lib/services/membership/join/capabilities";
import {
  isMemberApplicationAsIdentity,
  memberApplicationCreateAsIdentitySchema,
  memberApplicationCreateRouteSchema,
  memberApplicationCreateSchema,
  memberApplicationCreateResponseSchema,
} from "../../../../../assets/shared/schemas/member-applications";

function invalidPayload(error: { flatten: () => unknown }): never {
  // Field-level 422 (not the codebase's usual 400 VALIDATION_ERROR):
  // this public application endpoint specifically must return
  // 422 Unprocessable Entity for missing/invalid required fields.
  throw new AppError(422, "VALIDATION_ERROR", "Invalid application payload", error.flatten());
}

async function createAsIdentity(c: any, rawBody: unknown) {
  const env = c.env;
  const parsed = memberApplicationCreateAsIdentitySchema.safeParse(rawBody);
  if (!parsed.success) invalidPayload(parsed.error);
  const session = await resolveUserSessionFromRequest(env.DB, c.req.raw, env);
  if (!session.actingIdentities.some((identity) => identity.id === parsed.data.identityId))
    throw new AppError(403, "NOT_ACTIVE_IDENTITY", "You do not actively hold this identity");
  await enforceEmailTriggerRateLimits({
    emailBinding: env.EMAIL_RATE_LIMITER,
    ipBinding: env.IP_RATE_LIMITER,
    namespace: "member-applications",
    email: session.identity.email,
    clientIp: getClientIp(c.req.raw),
  });
  return createMemberApplicationAsIdentity(env.DB, {
    userId: session.identity.id,
    identityId: parsed.data.identityId,
    membershipCategory: parsed.data.membershipCategory,
    answers: parsed.data.answers,
    appBaseUrl: getConfig(env, c.req.raw).appBaseUrl,
  });
}

async function createThroughVerifiedEmail(c: any, rawBody: unknown) {
  const env = c.env;
  const parsed = memberApplicationCreateSchema.safeParse(rawBody);
  if (!parsed.success) invalidPayload(parsed.error);
  const body = parsed.data;
  await enforceEmailTriggerRateLimits({
    emailBinding: env.EMAIL_RATE_LIMITER,
    ipBinding: env.IP_RATE_LIMITER,
    namespace: "member-applications",
    email: body.applicantEmail,
    clientIp: getClientIp(c.req.raw),
  });
  const joinCapability = await verifyMemberJoinApplicationToken(requireInternalSecret(env), body.joinToken);
  if (joinCapability.email !== body.applicantEmail) {
    throw new AppError(
      401,
      "MEMBER_JOIN_CAPABILITY_INVALID",
      "Membership application capability does not match the verified email",
    );
  }
  return createMemberApplication(env.DB, {
    applicantEmail: joinCapability.email,
    applicantName: body.applicantName,
    membershipCategory: body.membershipCategory,
    organizationName: body.organizationName ?? null,
    answers: body.answers,
    appBaseUrl: getConfig(env, c.req.raw).appBaseUrl,
    joinCapabilityId: joinCapability.capabilityId,
    applicantKind: joinCapability.applicantKind,
    applicantUserId: joinCapability.applicantUserId,
  });
}

export async function onRequestPost(c: any): Promise<Response> {
  const rawBody = await readBoundedJsonBody(c.req.raw, JSON_REQUEST_MAX_BYTES);
  const created = isMemberApplicationAsIdentity(rawBody)
    ? await createAsIdentity(c, rawBody)
    : await createThroughVerifiedEmail(c, rawBody);
  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, created.outboxId));

  return json(
    memberApplicationCreateResponseSchema.parse({
      applicationId: created.id,
      stage: created.stage,
      manageToken: created.manageToken,
    }),
    201,
  );
}

export class MembersApplicationsPost extends OpenAPIRoute {
  schema = memberApplicationCreateRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
