import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { createTemplateVersion } from "../../../../../_lib/email/templates";
import type { PagesContext } from "../../../../../_lib/types";
import { adminEmailTemplateVersionSchema } from "../../../../../../assets/shared/schemas/api";

export async function onRequestPost(context: PagesContext<{ key: string }>): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request);
  const body = await parseJsonBody(context.request, adminEmailTemplateVersionSchema);

  const version = await createTemplateVersion(context.env.DB, {
    templateKey: context.params.key,
    content: body.content,
    subjectTemplate: body.subjectTemplate,
    contentType: body.contentType,
    createdByUserId: admin.id,
  });

  return json({ success: true, version });
}

export async function onRequest(context: PagesContext<{ key: string }>): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(context);
}
