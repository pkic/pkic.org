/**
 * POST /api/v1/members/applications
 *
 * Creates a member_applications record directly in D1 and queues its email
 * through the durable outbox. This is the only membership-application write
 * path; there is no generic form fallback.
 */
import { OpenAPIRoute } from "chanfana";
import { getConfig } from "../../../../_lib/config";
import { AppError } from "../../../../_lib/errors";
import { JSON_REQUEST_MAX_BYTES, readBoundedJsonBody } from "../../../../_lib/http-body";
import { json } from "../../../../_lib/http";
import { enforceEmailTriggerRateLimits } from "../../../../_lib/rate-limit";
import { getClientIp, requireInternalSecret } from "../../../../_lib/request";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { createMemberApplication } from "../../../../_lib/services/membership/applications/create";
import { verifyMemberJoinApplicationToken } from "../../../../_lib/services/membership/join/capabilities";
import {
  memberApplicationCreateRouteSchema,
  memberApplicationCreateSchema,
  memberApplicationCreateResponseSchema,
} from "../../../../../assets/shared/schemas/member-applications";

export async function onRequestPost(c: any): Promise<Response> {
  const env = c.env;
  const db = env.DB;
  const config = getConfig(env, c.req.raw);

  // Field-level 422 (not the codebase's usual 400 VALIDATION_ERROR):
  // this public application endpoint specifically must return
  // 422 Unprocessable Entity for missing/invalid required fields.
  const rawBody = await readBoundedJsonBody(c.req.raw, JSON_REQUEST_MAX_BYTES);
  const parsed = memberApplicationCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", "Invalid application payload", parsed.error.flatten());
  }
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

  const created = await createMemberApplication(db, {
    applicantEmail: joinCapability.email,
    applicantName: body.applicantName,
    membershipCategory: body.membershipCategory,
    organizationName: body.organizationName ?? null,
    answers: body.answers,
    appBaseUrl: config.appBaseUrl,
    joinCapabilityId: joinCapability.capabilityId,
    applicantKind: joinCapability.applicantKind,
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, env, created.outboxId));

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
