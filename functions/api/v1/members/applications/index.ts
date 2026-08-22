/**
 * POST /api/v1/members/applications
 *
 * Replaces POST /api/v1/forms (form_type=membership). Creates a
 * member_applications record directly in D1; no GitHub issue is filed.
 *
 * The old /api/v1/forms endpoint (functions/api/v1/forms.ts) is left in
 * place and untouched: the Hugo joinform shortcode still posts there until
 * the frontend is converted to call this endpoint.
 */
import { OpenAPIRoute } from "chanfana";
import { getConfig } from "../../../../_lib/config";
import { AppError } from "../../../../_lib/errors";
import { JSON_REQUEST_MAX_BYTES, readBoundedJsonBody } from "../../../../_lib/http-body";
import { json } from "../../../../_lib/http";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { getClientIp } from "../../../../_lib/request";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { createMemberApplication } from "../../../../_lib/services/membership/applications/create";
import {
  memberApplicationCreateRouteSchema,
  memberApplicationCreateSchema,
} from "../../../../../assets/shared/schemas/member-applications";

export async function onRequestPost(c: any): Promise<Response> {
  const env = c.env;
  const db = env.DB;
  const config = getConfig(env, c.req.raw);

  await enforceRateLimit({
    binding: env.IP_RATE_LIMITER,
    namespace: "member-applications:ip",
    key: getClientIp(c.req.raw),
  });

  // Field-level 422 (not the codebase's usual 400 VALIDATION_ERROR):
  // this public application endpoint specifically must return
  // 422 Unprocessable Entity for missing/invalid required fields.
  const rawBody = await readBoundedJsonBody(c.req.raw, JSON_REQUEST_MAX_BYTES);
  const parsed = memberApplicationCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", "Invalid application payload", parsed.error.flatten());
  }
  const body = parsed.data;

  const created = await createMemberApplication(db, {
    applicantEmail: body.applicantEmail,
    applicantName: body.applicantName,
    membershipCategory: body.membershipCategory,
    organizationName: body.organizationName ?? null,
    answers: body.answers,
    appBaseUrl: config.appBaseUrl,
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, env, created.outboxId));

  return json({ applicationId: created.id, stage: created.stage, manageToken: created.manageToken }, 201);
}

export class MembersApplicationsPost extends OpenAPIRoute {
  schema = memberApplicationCreateRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
