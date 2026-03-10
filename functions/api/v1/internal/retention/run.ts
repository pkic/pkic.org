import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { runRetentionJob } from "../../../../_lib/services/retention";
import type { PagesContext } from "../../../../_lib/types";

export async function onRequestPost(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request);
  const result = await runRetentionJob(context.env.DB);
  return json({ success: true, ...result });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
