import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { processPendingOutbox, processSelectedOutbox } from "../../../../_lib/email/outbox";
import type { PagesContext } from "../../../../_lib/types";
import { adminRetryOutboxSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminRetryOutboxSchema);
  const result = body.ids?.length
    ? await processSelectedOutbox(context.env.DB, context.env, body.ids)
    : await processPendingOutbox(context.env.DB, context.env, body.limit);
  return json({ success: true, ...result });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
