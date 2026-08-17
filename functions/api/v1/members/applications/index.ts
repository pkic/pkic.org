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
import { json } from "../../../../_lib/http";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { getClientIp } from "../../../../_lib/request";
import { queueEmail, processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../_lib/services/audit";
import {
  createMemberApplication,
  emailDomain,
  hasActiveApplicationForDomain,
  hasConflictingOrganizationDomain,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
} from "../../../../_lib/services/membership/applications/create";
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
  let rawBody: unknown;
  try {
    rawBody = await c.req.raw.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const parsed = memberApplicationCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", "Invalid application payload", parsed.error.flatten());
  }
  const body = parsed.data;

  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(body.membershipCategory);
  if (!isIndividual) {
    const domain = emailDomain(body.applicantEmail);
    if ((await hasActiveApplicationForDomain(db, domain)) || (await hasConflictingOrganizationDomain(db, domain))) {
      throw new AppError(409, "DUPLICATE_APPLICATION", "An active application already exists for this organization");
    }
  }

  const created = await createMemberApplication(db, {
    applicantEmail: body.applicantEmail,
    applicantName: body.applicantName,
    membershipCategory: body.membershipCategory,
    organizationName: body.organizationName ?? null,
    answers: body.answers,
  });

  const statusUrl = `${config.appBaseUrl}/application-status/?id=${created.id}&token=${created.manageToken}`;
  const outboxId = await queueEmail(db, {
    templateKey: "application-received",
    recipientEmail: body.applicantEmail,
    messageType: "transactional",
    subject: "We received your PKI Consortium membership application",
    data: {
      applicantName: body.applicantName,
      statusUrl,
    },
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, env, outboxId));

  await writeAuditLog(db, "public", null, "member_application_submitted", "member_application", created.id, {
    applicantEmail: body.applicantEmail,
    membershipCategory: body.membershipCategory,
  });

  return json(
    { applicationId: created.id, status: created.status, stage: created.stage, manageToken: created.manageToken },
    201,
  );
}

export class MembersApplicationsPost extends OpenAPIRoute {
  schema = memberApplicationCreateRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
