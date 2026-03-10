import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { activateTemplateVersion } from "../../../../../_lib/email/templates";
import type { PagesContext } from "../../../../../_lib/types";
import { adminEmailTemplateActivateSchema } from "../../../../../../shared/schemas/api";

export async function onRequestPost(context: PagesContext<{ key: string }>): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request);
  const body = await parseJsonBody(context.request, adminEmailTemplateActivateSchema);

  await activateTemplateVersion(context.env.DB, {
    templateKey: context.params.key,
    version: body.version,
  });

  return json({ success: true });
}

export async function onRequest(context: PagesContext<{ key: string }>): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(context);
}
