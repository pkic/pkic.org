import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { processPendingOutbox, processSelectedOutbox } from "../../../../_lib/email/outbox";
import { adminRetryOutboxSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminRetryOutboxSchema);
  const result = body.ids?.length
    ? await processSelectedOutbox(c.env.DB, c.env, body.ids)
    : await processPendingOutbox(c.env.DB, c.env, body.limit);
  return json({ success: true, ...result });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}

export class InternalEmailRetryPost extends OpenAPIRoute {
  schema = {
    tags: ["Internal", "Email"],
    summary: "Retry failed/pending outbox email messages",
    request: {
      body: {
        content: {
          "application/json": {
            schema: adminRetryOutboxSchema,
          },
        },
        required: true,
      },
    },
    responses: {
      "200": {
        description: "Retry batch completed successfully.",
      },
      "401": {
        description: "Admin authorization required.",
      },
    },
  };

  async handle(c: any) {
    return onRequestPost(c);
  }
}
