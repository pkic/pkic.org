import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { templateKeyExists } from "../../../../../_lib/email/templates";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const key = c.req.param("key");
  const exists = await templateKeyExists(requestDb(c), key);
  return json({ exists });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
