import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { templateKeyExists } from "../../../../../_lib/email/templates";

export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw);
  const key = c.req.param("key");
  const exists = await templateKeyExists(c.env.DB, key);
  return json({ exists });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
