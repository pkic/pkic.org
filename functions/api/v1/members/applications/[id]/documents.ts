/** Token-gated upload plus capability-or-staff bounded list endpoint. */
import { applicationDocumentUploadRouteSchema } from "../../../../../../assets/shared/schemas/member-applications";
import { applicationDocumentsReadRouteSchema } from "../../../../../../assets/shared/schemas/application-documents";
import { getApplicationDocumentLimits } from "../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { readBoundedMultipartFormData } from "../../../../../_lib/http-body";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { enforceRateLimit } from "../../../../../_lib/rate-limit";
import { getClientIp } from "../../../../../_lib/request";
import {
  listApplicationDocuments,
  listStaffApplicationDocuments,
  uploadApplicationDocument,
} from "../../../../../_lib/services/membership/applications/documents";
import {
  getMemberApplicationById,
  verifyApplicationManageToken,
} from "../../../../../_lib/services/membership/applications/queries";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";

async function requireApplication(db: ReturnType<typeof requestDb>, applicationId: string, token: string) {
  const application = await verifyApplicationManageToken(db, applicationId, token);
  if (!application) {
    throw new AppError(401, "AUTH_INVALID", "Invalid application id or token");
  }
  return application;
}

function requireUploadsBucket(c: AdminContext): R2Bucket {
  if (!c.env.ASSETS_BUCKET) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
  }
  return c.env.ASSETS_BUCKET;
}

function requireSingleFile(formData: FormData): File {
  const files = formData.getAll("file");
  if (files.length !== 1 || typeof files[0] === "string") {
    throw new AppError(400, "MISSING_FILE", "Exactly one file is required under the 'file' field");
  }
  return files[0];
}

async function enforceDocumentIpRateLimit(c: AdminContext): Promise<void> {
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "application-documents:ip",
    key: getClientIp(c.req.raw),
  });
}

async function enforceDocumentApplicationRateLimit(c: AdminContext, applicationId: string): Promise<void> {
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "application-documents:application",
    key: applicationId,
  });
}

export const MembersApplicationsDocumentsPost = openApiRoute(
  applicationDocumentUploadRouteSchema,
  async (c: AdminContext, data) => {
    c.set?.("sensitive", true);
    await enforceDocumentIpRateLimit(c);
    const db = requestDb(c);
    const application = await requireApplication(db, data.params.id, data.query.token);
    await enforceDocumentApplicationRateLimit(c, application.id);

    const limits = getApplicationDocumentLimits(c.env);
    const bucket = requireUploadsBucket(c);
    const formData = await readBoundedMultipartFormData(c.req.raw, limits.maxFileBytes);
    const document = await uploadApplicationDocument({
      db,
      bucket,
      applicationId: application.id,
      applicationStage: application.stage,
      uploadedByEmail: application.applicant_email,
      file: requireSingleFile(formData),
      idempotencyKey: data.headers["idempotency-key"],
      limits,
    });
    return json({ document }, 201);
  },
);

export const MembersApplicationsDocumentsGet = openApiRoute(
  applicationDocumentsReadRouteSchema,
  async (c: AdminContext, data) => {
    c.set?.("sensitive", true);
    const { token, ...query } = data.query;
    if (token) {
      await enforceDocumentIpRateLimit(c);
      const db = requestDb(c);
      const application = await requireApplication(db, data.params.id, token);
      await enforceDocumentApplicationRateLimit(c, application.id);
      return json(await listApplicationDocuments(db, application.id, query));
    }

    const { db } = await requireStaffPermission(c, "membership:read");
    const application = await getMemberApplicationById(db, data.params.id);
    if (!application) {
      throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
    }
    return json(await listStaffApplicationDocuments(db, application.id, query));
  },
);
