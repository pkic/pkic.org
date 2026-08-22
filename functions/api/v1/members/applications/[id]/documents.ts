/** Token-gated supporting-document upload and bounded list endpoints. */
import {
  applicationDocumentListRouteSchema,
  applicationDocumentUploadRouteSchema,
} from "../../../../../../assets/shared/schemas/member-applications";
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
  uploadApplicationDocument,
} from "../../../../../_lib/services/membership/applications/documents";
import { verifyApplicationManageToken } from "../../../../../_lib/services/membership/applications/queries";

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
  applicationDocumentListRouteSchema,
  async (c: AdminContext, data) => {
    c.set?.("sensitive", true);
    await enforceDocumentIpRateLimit(c);
    const db = requestDb(c);
    const application = await requireApplication(db, data.params.id, data.query.token);
    await enforceDocumentApplicationRateLimit(c, application.id);
    return json(await listApplicationDocuments(db, application.id, data.query));
  },
);
