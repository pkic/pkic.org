import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { createTemplateVersion } from "../../../../../_lib/email/templates";
import { all } from "../../../../../_lib/db/queries";
import { adminEmailTemplateVersionSchema } from "../../../../../../assets/shared/schemas/api";

export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const key = c.req.param("key");

  const versions = await all(
    c.env.DB,
    `SELECT * FROM email_template_versions
     WHERE template_key = ?
     ORDER BY version DESC`,
    [key],
  );

  return json({ versions });
}

export async function onRequestPost(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw);
  const body = await parseJsonBody(c.req, adminEmailTemplateVersionSchema);

  const version = await createTemplateVersion(c.env.DB, {
    templateKey: c.req.param("key"),
    content: body.content,
    subjectTemplate: body.subjectTemplate,
    contentType: body.contentType,
    createdByUserId: admin.id,
  });

  return json({ success: true, version });
}

export async function onRequest(c: any): Promise<Response> {
  const method = c.req.raw.method;
  if (method === "GET") return onRequestGet(c);
  if (method === "POST") return onRequestPost(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
