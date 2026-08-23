/**
 * POST /api/v1/admin/applications/:id/communications.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { sendApplicationCommunication } from "../../../../../_lib/services/membership/applications/communications";
import {
  applicationCommunicationCreateResponseSchema,
  applicationCommunicationCreateRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const ApplicationCommunicationsPost = openApiRoute(
  applicationCommunicationCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "membership:write");

    const body = data.body;
    const result = await sendApplicationCommunication(db, {
      applicationId: data.params.id,
      actor: admin,
      subject: body.subject,
      body: body.body,
      templateKey: body.templateKey ?? null,
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
    return json(
      applicationCommunicationCreateResponseSchema.parse({ id: result.id, createdAt: result.createdAt }),
      201,
    );
  },
);
