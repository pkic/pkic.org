/**
 * POST /api/v1/system/membership-applications/:id/communications.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { sendApplicationCommunication } from "../../../../../_lib/services/membership/applications/communications";
import {
  applicationCommunicationCreateResponseSchema,
  applicationCommunicationCreateRouteSchema,
} from "../../../../../../assets/shared/schemas/membership-application-management";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireSystemPermission } from "../../authorization";

export const ApplicationCommunicationsPost = openApiRoute(
  applicationCommunicationCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireSystemPermission(c, "membership:write");

    const body = data.body;
    const result = await sendApplicationCommunication(db, {
      applicationId: data.params.id,
      actor: staff,
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
